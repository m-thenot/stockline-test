import Dexie, { type EntityTable } from "dexie";
import type {
  PreOrder,
  PreOrderFlow,
  Metadata,
  OutboxOperation,
} from "./models";

export class SyncDB extends Dexie {
  metadata!: EntityTable<Metadata, "key">;
  pre_orders!: EntityTable<PreOrder, "id">;
  pre_order_flows!: EntityTable<PreOrderFlow, "id">;
  outbox!: EntityTable<OutboxOperation, "id">;

  constructor() {
    super("SyncDB");

    this.version(1).stores({
      metadata: "key", // PK: key
      pre_orders: "id, created_at", // PK: id, Index: created_at
      pre_order_flows: "id, pre_order_id", // PK: id, Index: pre_order_id
      outbox: "id, sequence_number, status", // PK: id, Indexes: sequence_number, status
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
   */
  async getPendingOperations(): Promise<OutboxOperation[]> {
    return await this.outbox
      .where("status")
      .equals("pending")
      .sortBy("sequence_number");
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
   */
  async markOperationFailed(operationId: string): Promise<void> {
    const operation = await this.outbox.get(operationId);
    if (operation) {
      await this.outbox.update(operationId, {
        status: "failed",
        retry_count: operation.retry_count + 1,
      });
    }
  }

  /**
   * Add a new operation to the outbox
   */
  async addOutboxOperation(
    operation: Omit<OutboxOperation, "sequence_number">,
  ): Promise<void> {
    const sequenceNumber = await this.getNextSequenceNumber();
    await this.outbox.add({
      ...operation,
      sequence_number: sequenceNumber,
    });
  }
}

/**
 * Singleton database instance
 * Auto-initializes on first use
 */
export const db = new SyncDB();
