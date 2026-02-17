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
  pullSyncing: boolean;
}

export interface PushResult {
  processedCount: number; // Total operations processed
  successCount: number; // Successfully synced operations
  failedCount: number; // Failed operations
  errors: Array<{ operationId: string; error: Error }>; // Individual errors
}

// --- Sync Push request/response types (mirrors backend schemas) ---

export interface PushOperationRequest {
  id: string;
  entity_type: "pre_order" | "pre_order_flow";
  entity_id: string;
  operation_type: "CREATE" | "UPDATE" | "DELETE";
  data: Record<string, unknown>;
  expected_version: number | null;
  timestamp: string;
}

export interface PushRequestBody {
  operations: PushOperationRequest[];
}

export interface ResolvedFieldConflict {
  field: string;
  client_value: string | number | boolean | null;
  server_value: string | number | boolean | null;
  winner: "client" | "server";
}

export interface PushOperationResult {
  operation_id: string;
  status: "success" | "conflict" | "error";
  sync_id: number | null;
  new_version: number | null;
  message: string | null;
  conflicts: ResolvedFieldConflict[] | null;
}

export interface PushResponseBody {
  results: PushOperationResult[];
}

// --- SSE types ---

export interface SSEEvent {
  event: string;
  entity_type: string;
  entity_id: string;
  sync_id: number;
}

// --- Sync Pull types ---

export interface PullOperation {
  sync_id: number;
  entity_type: string;
  entity_id: string;
  operation_type: "CREATE" | "UPDATE" | "DELETE";
  data: Record<string, unknown>;
  timestamp: string;
}

export interface PullResponse {
  operations: PullOperation[];
  has_more: boolean;
}
