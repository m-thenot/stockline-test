export type OperationType = "CREATE" | "UPDATE" | "DELETE";
export type EntityType = "pre_order" | "pre_order_flow";
export type OperationStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | "rejected";

/**
 * PreOrder Entity
 */
export interface PreOrder {
  id: string; // UUIDv7
  partner_id: string;
  status: number; // 0=pending, 1=confirmed
  order_date: string | null;
  comment: string | null;
  delivery_date: string;
  created_at: string | null;
  updated_at: string | null;
  version: number;
  deleted_at: string | null;
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
  comment: string | null;
  created_at: string | null;
  updated_at: string | null;
  version: number;
  deleted_at: string | null;
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
  next_retry_at: number | null; // Timestamp (ms) for next retry attempt
  last_error: string | null; // Last error message for debugging
}

/**
 * Partner (Reference Data)
 */
export interface Partner {
  id: string;
  name: string;
  code: string | null;
  type: number; // 1=client, 2=supplier
}

/**
 * Product (Reference Data)
 */
export interface Product {
  id: string;
  name: string;
  short_name: string | null;
  sku: string | null;
  code: string | null;
}

/**
 * Unit (Reference Data)
 */
export interface Unit {
  id: string;
  name: string;
  abbreviation: string;
}
