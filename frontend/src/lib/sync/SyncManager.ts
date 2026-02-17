import { db } from "@/lib/db";
import type { SyncDB } from "@/lib/db";
import { logger } from "@/lib/utils/logger";
import { PushService } from "./PushService";
import { PullService } from "./PullService";
import { SSEService, type SSEEvent } from "./SSEService";
import type {
  SyncConfig,
  SyncStatus,
  SyncState,
  ConnectionState,
} from "./types";

export class SyncManager {
  private static instance: SyncManager | null = null;

  private pushService: PushService;
  private pullService: PullService;
  private sseService: SSEService;

  private state: SyncState = "idle";
  private connection: ConnectionState = "unknown";
  private lastPushTime: Date | null = null;
  private lastError: Error | null = null;
  private pendingOperations = 0;

  private config: SyncConfig = {
    pushIntervalMs: 30000, // 30 seconds
    enableAutoPush: true,
  };

  private pushIntervalId: number | null = null;
  private isPushing = false;
  private pullDebounceTimer: number | null = null;
  private readonly PULL_DEBOUNCE_MS = 100; // Debounce rapid SSE events

  // Sync queue to serialize push/pull operations
  private syncQueue: Array<{
    type: "push" | "pull";
    fn: () => Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private isProcessingSyncQueue = false;

  // Subscribe/notify for useSyncExternalStore
  private listeners = new Set<() => void>();
  private _snapshot: SyncStatus = {
    state: "idle",
    connection: "unknown",
    lastPushTime: null,
    lastError: null,
    pendingOperations: 0,
    pullSyncing: false,
  };

  /**
   * Private constructor for singleton pattern
   */
  private constructor(database: SyncDB) {
    this.pushService = new PushService(database);
    this.pullService = new PullService(database);
    this.sseService = new SSEService((event) => this.handleSSEEvent(event));

    // Initialize connection state
    this.connection = this.detectConnection();

    // Setup connection listeners
    this.setupConnectionListeners();

    // Rebuild snapshot after connection detection
    this._snapshot = this.buildSnapshot();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SyncManager {
    if (!SyncManager.instance) {
      SyncManager.instance = new SyncManager(db);
    }
    return SyncManager.instance;
  }

  /**
   * Start auto-push scheduling and connection monitoring
   * Performs initial push immediately
   */
  public start(): void {
    if (this.pushIntervalId !== null) {
      logger.warn("SyncManager already started");
      return;
    }

    this.pullService.start().catch((error) => {
      logger.error("Initial pull sync failed:", error);
    });

    // Connect SSE if online
    if (this.isOnline()) {
      this.sseService.connect();
    }

    // Initial push
    this.push().catch((error) => {
      logger.error("Initial push failed:", error);
    });

    // Schedule recurring push
    if (this.config.enableAutoPush) {
      this.pushIntervalId = window.setInterval(() => {
        if (this.isOnline()) {
          this.push().catch((error) => {
            logger.error("Auto-push failed:", error);
          });
        }
      }, this.config.pushIntervalMs);
    }
  }

  /**
   * Stop auto-push scheduling and disconnect SSE
   */
  public stop(): void {
    if (this.pushIntervalId !== null) {
      clearInterval(this.pushIntervalId);
      this.pushIntervalId = null;
    }
    this.sseService.disconnect();
    if (this.pullDebounceTimer !== null) {
      clearTimeout(this.pullDebounceTimer);
      this.pullDebounceTimer = null;
    }
    // Clear sync queue
    this.syncQueue = [];
  }

  /**
   * Cleanup and destroy instance
   */
  public destroy(): void {
    this.stop();
    this.listeners.clear();
    SyncManager.instance = null;
  }

  /**
   * Subscribe to state changes (contract for useSyncExternalStore)
   * @returns unsubscribe function
   */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get memoized snapshot (stable reference for useSyncExternalStore)
   */
  public getSnapshot(): SyncStatus {
    return this._snapshot;
  }

  /**
   * Manually trigger push
   * Processes all pending operations and sends them to the server
   * Uses queue to serialize with pull operations
   */
  public async push(): Promise<void> {
    // Check connection
    if (!this.isOnline()) {
      logger.warn("Cannot push: offline");
      return;
    }

    // Enqueue push operation
    return this.enqueueSync("push", async () => {
      // Prevent concurrent pushes (safety check)
      if (this.isPushing) {
        logger.warn("Push already in progress");
        return;
      }

      this.isPushing = true;
      this.updateState("pushing");

      try {
        // Execute push via PushService
        const result = await this.pushService.pushOperations();

        // Update state after successful push
        this.lastPushTime = new Date();
        this.lastError = null;

        // Update pending count
        await this.updatePendingCount();

        // Update state to idle (also triggers notify via updateState)
        this.updateState("idle");
        this.notify();

        // Log result
        logger.info(
          `Push completed: ${result.successCount}/${result.processedCount} synced`,
        );

        if (result.failedCount > 0) {
          logger.warn(`${result.failedCount} operations failed`, result.errors);
        }
      } catch (error) {
        // Handle push error
        const err = error instanceof Error ? error : new Error(String(error));
        this.lastError = err;
        this.updateState("error");

        logger.error("Push failed:", err);
        throw err;
      } finally {
        this.isPushing = false;
      }
    });
  }

  /**
   * Trigger incremental pull
   * Uses queue to serialize with push operations
   */
  public async pull(): Promise<void> {
    if (!this.isOnline()) {
      logger.warn("Cannot pull: offline");
      return;
    }

    return this.enqueueSync("pull", async () => {
      await this.pullService.pullIncremental();
    });
  }

  /**
   * Enqueue a sync operation (push or pull) to be processed sequentially.
   * Ensures push and pull never run concurrently.
   */
  private async enqueueSync(
    type: "push" | "pull",
    fn: () => Promise<void>,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.syncQueue.push({
        type,
        fn,
        resolve,
        reject: (error: Error) => reject(error),
      });

      // Start processing queue if not already processing
      this.processSyncQueue().catch((error) => {
        logger.error("Error processing sync queue:", error);
      });
    });
  }

  /**
   * Process sync queue sequentially.
   * Ensures only one sync operation (push or pull) runs at a time.
   */
  private async processSyncQueue(): Promise<void> {
    // Already processing, wait for current task to finish
    if (this.isProcessingSyncQueue) {
      return;
    }

    this.isProcessingSyncQueue = true;

    try {
      while (this.syncQueue.length > 0) {
        const task = this.syncQueue.shift();
        if (!task) {
          break;
        }

        logger.debug(`Processing ${task.type} from sync queue`);

        try {
          await task.fn();
          task.resolve();
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          task.reject(err);
        }
      }
    } finally {
      this.isProcessingSyncQueue = false;
    }
  }

  /**
   * Get current sync status
   */
  public getStatus(): SyncStatus {
    return this._snapshot;
  }

  /**
   * Check if online
   */
  public isOnline(): boolean {
    return this.connection === "online";
  }

  /**
   * Update sync state and notify subscribers
   */
  private updateState(newState: SyncState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.notify();
    }
  }

  /**
   * Update connection state and notify subscribers
   */
  private updateConnection(newConnection: ConnectionState): void {
    if (this.connection !== newConnection) {
      this.connection = newConnection;
      this.notify();
    }
  }

  /**
   * Build a new snapshot object from current state
   */
  private buildSnapshot(): SyncStatus {
    const pullStatus = this.pullService.getStatus();

    return {
      state: this.state,
      connection: this.connection,
      lastPushTime: this.lastPushTime,
      lastError: this.lastError,
      pendingOperations: this.pendingOperations,
      pullSyncing: pullStatus.syncing,
    };
  }

  /**
   * Rebuild snapshot and notify all subscribers (triggers React re-renders)
   */
  private notify(): void {
    this._snapshot = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Detect current connection state
   */
  private detectConnection(): ConnectionState {
    return navigator.onLine ? "online" : "offline";
  }

  /**
   * Setup browser connection event listeners
   */
  private setupConnectionListeners(): void {
    window.addEventListener("online", async () => {
      logger.info("Connection: online");
      this.updateConnection("online");

      // Connect SSE
      this.sseService.connect();

      // Trigger immediate push on reconnect, then pull
      try {
        await this.push();
        logger.info("Push completed, pulling server changes...");
        await this.pull();
      } catch (error) {
        logger.error("Sync after reconnect failed:", error);
      }
    });

    window.addEventListener("offline", () => {
      logger.info("Connection: offline");
      this.updateConnection("offline");

      // Disconnect SSE (EventSource would retry anyway, but we're explicit)
      this.sseService.disconnect();
    });
  }

  /**
   * Handle SSE event: debounce and trigger incremental pull via queue
   */
  private handleSSEEvent(event: SSEEvent): void {
    logger.info("SSE event received:", event);

    // Clear existing debounce timer
    if (this.pullDebounceTimer !== null) {
      clearTimeout(this.pullDebounceTimer);
    }

    // Debounce: wait a bit to batch rapid events
    this.pullDebounceTimer = window.setTimeout(() => {
      this.pullDebounceTimer = null;
      if (this.isOnline()) {
        // Use queue to ensure pull doesn't conflict with push
        this.pull().catch((error) => {
          logger.error("Pull after SSE event failed:", error);
        });
      }
    }, this.PULL_DEBOUNCE_MS);
  }

  /**
   * Update pending operations count from database
   */
  private async updatePendingCount(): Promise<void> {
    const operations = await db.getPendingOperations();
    this.pendingOperations = operations.length;
  }
}
