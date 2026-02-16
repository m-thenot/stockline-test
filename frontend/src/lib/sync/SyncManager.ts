import { db } from "@/lib/db";
import type { SyncDB } from "@/lib/db";
import { logger } from "@/lib/utils/logger";
import { PushService } from "./PushService";
import type {
  SyncConfig,
  SyncStatus,
  SyncState,
  ConnectionState,
} from "./types";

export class SyncManager {
  private static instance: SyncManager | null = null;

  private pushService: PushService;

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

  /**
   * Private constructor for singleton pattern
   */
  private constructor(database: SyncDB) {
    this.pushService = new PushService(database);

    // Initialize connection state
    this.connection = this.detectConnection();

    // Setup connection listeners
    this.setupConnectionListeners();
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

    // Initial push
    this.push().catch((error) => {
      logger.error("Initial push failed:", error);
    });

    // Schedule recurring push
    if (this.config.enableAutoPush) {
      this.pushIntervalId = window.setInterval(() => {
        if (this.isOnline() && !this.isPushing) {
          this.push().catch((error) => {
            logger.error("Auto-push failed:", error);
          });
        }
      }, this.config.pushIntervalMs);
    }
  }

  /**
   * Stop auto-push scheduling
   */
  public stop(): void {
    if (this.pushIntervalId !== null) {
      clearInterval(this.pushIntervalId);
      this.pushIntervalId = null;
    }
  }

  /**
   * Cleanup and destroy instance
   */
  public destroy(): void {
    this.stop();
    SyncManager.instance = null;
  }

  /**
   * Manually trigger push
   * Processes all pending operations and sends them to the server
   */
  public async push(): Promise<void> {
    // Prevent concurrent pushes
    if (this.isPushing) {
      logger.warn("Push already in progress");
      return;
    }

    // Check connection
    if (!this.isOnline()) {
      logger.warn("Cannot push: offline");
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

      // Update state to idle
      this.updateState("idle");

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
  }

  /**
   * Get current sync status
   */
  public getStatus(): SyncStatus {
    return {
      state: this.state,
      connection: this.connection,
      lastPushTime: this.lastPushTime,
      lastError: this.lastError,
      pendingOperations: this.pendingOperations,
    };
  }

  /**
   * Check if online
   */
  public isOnline(): boolean {
    return this.connection === "online";
  }

  /**
   * Update sync state
   */
  private updateState(newState: SyncState): void {
    if (this.state !== newState) {
      this.state = newState;
    }
  }

  /**
   * Update connection state
   */
  private updateConnection(newConnection: ConnectionState): void {
    if (this.connection !== newConnection) {
      this.connection = newConnection;
    }
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
    window.addEventListener("online", () => {
      logger.info("Connection: online");
      this.updateConnection("online");

      // Trigger immediate push on reconnect
      if (this.pushIntervalId !== null) {
        this.push().catch((error) => {
          logger.error("Push after reconnect failed:", error);
        });
      }
    });

    window.addEventListener("offline", () => {
      logger.info("Connection: offline");
      this.updateConnection("offline");
    });
  }

  /**
   * Update pending operations count from database
   */
  private async updatePendingCount(): Promise<void> {
    const operations = await db.getPendingOperations();
    this.pendingOperations = operations.length;
  }
}
