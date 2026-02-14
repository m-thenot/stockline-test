export type OperationType = "CREATE" | "UPDATE" | "DELETE";
export type EntityType = "pre_order" | "pre_order_flow";
export type OperationStatus = "pending" | "syncing" | "synced" | "failed";

/**
 * PreOrder Entity
 */
export interface PreOrder {
  id: string; // UUIDv7
  partner_id: string;
  status: number; // 0=pending, 1=confirmed
  order_date?: string;
  comment?: string;
  delivery_date: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/**
 * PreOrderFlow Entity
 * Represents a line item in a pre-order
 */
export interface PreOrderFlow {
  id: string; // UUIDv7
  pre_order_id: string;
  product_id: string;
  unit_id: string;
  quantity: number;
  price: number;
  comment?: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/**
 * Metadata Table (Key-Value Store)
 * Stores sync state and configuration
 */
export interface Metadata {
  key: string; // Primary key (e.g., "last_sync_id")
  value: number | string | boolean; // Value (type depends on key)
}

/**
 * Outbox Operation
 * Queue of operations to sync to server (FIFO)
 */
export interface OutboxOperation {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  operation_type: OperationType;
  data: unknown;
  timestamp: string;
  status: OperationStatus;
  retry_count: number;
  sequence_number: number;
}
