export type SyncState = "idle" | "pushing" | "error";
export type ConnectionState = "online" | "offline" | "unknown";

export interface SyncConfig {
  pushIntervalMs: number; // Polling interval for auto-push (default: 30000ms)
  enableAutoPush: boolean; // Enable automatic push (default: true)
}

/**
 * Current sync status exposed to UI
 */
export interface SyncStatus {
  state: SyncState;
  connection: ConnectionState;
  lastPushTime: Date | null;
  lastError: Error | null;
  pendingOperations: number;
}

export interface PushResult {
  processedCount: number; // Total operations processed
  successCount: number; // Successfully synced operations
  failedCount: number; // Failed operations
  errors: Array<{ operationId: string; error: Error }>; // Individual errors
}
