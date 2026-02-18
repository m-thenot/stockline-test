import Dexie, { type EntityTable } from "dexie";
import type {
  PreOrder,
  PreOrderFlow,
  Metadata,
  OutboxOperation,
  EntityType,
  Partner,
  Product,
  Unit,
} from "./models";

export class SyncDB extends Dexie {
  metadata!: EntityTable<Metadata, "key">;
  pre_orders!: EntityTable<PreOrder, "id">;
  pre_order_flows!: EntityTable<PreOrderFlow, "id">;
  outbox!: EntityTable<OutboxOperation, "id">;
  partners!: EntityTable<Partner, "id">;
  products!: EntityTable<Product, "id">;
  units!: EntityTable<Unit, "id">;

  constructor() {
    super("SyncDB");

    this.version(1).stores({
      metadata: "key",
      pre_orders: "id, partner_id, delivery_date, created_at",
      pre_order_flows: "id, pre_order_id, product_id",
      outbox: "id, sequence_number, status, next_retry_at",
      partners: "id, name",
      products: "id, name",
      units: "id, name",
    });

    // Auto-initialize metadata on first launch
    this.on("ready", async () => {
      await this.initializeMetadata();
    });
  }

  /**
   * Initialize metadata with default values
   */
  async initializeMetadata(): Promise<void> {
    const lastSyncId = await this.metadata.get("last_sync_id");
    if (!lastSyncId) {
      await this.metadata.put({ key: "last_sync_id", value: 0 });
    }
  }

  /**
   * Get the last sync ID from metadata
   */
  async getLastSyncId(): Promise<number> {
    const metadata = await this.metadata.get("last_sync_id");
    return metadata ? (metadata.value as number) : 0;
  }

  /**
   * Set the last sync ID in metadata
   */
  async setLastSyncId(syncId: number): Promise<void> {
    await this.metadata.put({ key: "last_sync_id", value: syncId });
  }

  /**
   * Get the next sequence number for outbox operations
   * Ensures FIFO ordering (CREATE before UPDATE before DELETE)
   */
  async getNextSequenceNumber(): Promise<number> {
    const lastOperation = await this.outbox
      .orderBy("sequence_number")
      .reverse()
      .first();

    return lastOperation ? lastOperation.sequence_number + 1 : 1;
  }

  /**
   * Get all pending operations from outbox (ordered by sequence)
   * Includes both "pending" operations and "failed" operations that are ready for retry
   */
  async getPendingOperations(): Promise<OutboxOperation[]> {
    const now = Date.now();

    // Get pending operations
    const pending = await this.outbox
      .where("status")
      .equals("pending")
      .toArray();

    // Get failed operations that are ready for retry
    const failedReady = await this.outbox
      .where("status")
      .equals("failed")
      .filter((op) => op.next_retry_at !== null && op.next_retry_at <= now)
      .toArray();

    // Combine and sort by sequence_number
    return [...pending, ...failedReady].sort(
      (a, b) => a.sequence_number - b.sequence_number,
    );
  }

  /**
   * Mark an operation as syncing
   */
  async markOperationSyncing(operationId: string): Promise<void> {
    await this.outbox.update(operationId, { status: "syncing" });
  }

  /**
   * Mark an operation as synced
   */
  async markOperationSynced(operationId: string): Promise<void> {
    await this.outbox.update(operationId, { status: "synced" });
  }

  /**
   * Mark an operation as failed and increment retry count
   * Calculates next_retry_at with exponential backoff
   */
  async markOperationFailed(
    operationId: string,
    errorMessage?: string,
  ): Promise<void> {
    const operation = await this.outbox.get(operationId);
    if (!operation) {
      return;
    }

    const newRetryCount = operation.retry_count + 1;
    const MAX_RETRIES = 5;
    const BASE_DELAY_MS = 1000; // 1 second
    const MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes

    let next_retry_at: number | null = null;

    if (newRetryCount <= MAX_RETRIES) {
      // Calculate exponential backoff: BASE_DELAY * (2 ^ retry_count)
      const delayMs = Math.min(
        BASE_DELAY_MS * Math.pow(2, newRetryCount - 1),
        MAX_DELAY_MS,
      );
      next_retry_at = Date.now() + delayMs;
    }
    // If newRetryCount > MAX_RETRIES, next_retry_at remains null (permanently failed)

    await this.outbox.update(operationId, {
      status: "failed",
      retry_count: newRetryCount,
      next_retry_at,
      last_error: errorMessage ?? null,
    });
  }

  /**
   * Mark an operation as permanently rejected by the server
   * Used for business errors (validation, conflicts, etc.) that should NOT be retried
   */
  async markOperationRejected(
    operationId: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.outbox.update(operationId, {
      status: "rejected",
      last_error: errorMessage ?? null,
    });
  }

  /**
   * Add a new operation to the outbox
   */
  async addOutboxOperation(
    operation: Omit<
      OutboxOperation,
      "sequence_number" | "next_retry_at" | "last_error"
    >,
  ): Promise<void> {
    const sequenceNumber = await this.getNextSequenceNumber();
    await this.outbox.add({
      ...operation,
      sequence_number: sequenceNumber,
      next_retry_at: null,
      last_error: null,
    });
  }

  /**
   * Batch-mark multiple operations as syncing
   */
  async markOperationsSyncing(ids: string[]): Promise<void> {
    await this.outbox.where("id").anyOf(ids).modify({ status: "syncing" });
  }

  /**
   * Batch-mark multiple operations as synced
   */
  async markOperationsSynced(ids: string[]): Promise<void> {
    await this.outbox.where("id").anyOf(ids).modify({ status: "synced" });
  }

  /**
   * Update the version of an entity in IndexedDB after server confirms.
   * Routes to the correct table based on entity_type.
   */
  async updateEntityVersion(
    entityType: EntityType,
    entityId: string,
    newVersion: number,
  ): Promise<void> {
    const table =
      entityType === "pre_order" ? this.pre_orders : this.pre_order_flows;
    await table.update(entityId, { version: newVersion });
  }
}

/**
 * Singleton database instance
 * Auto-initializes on first use
 */
export const db = new SyncDB();
