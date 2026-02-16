import type { SyncDB } from "@/lib/db";
import type { OutboxOperation } from "@/lib/db/models";
import { api } from "@/lib/api";
import { logger } from "@/lib/utils/logger";
import type { PushResult } from "./types";

export class PushService {
  constructor(private db: SyncDB) {}

  /**
   * Push all pending operations to the server
   * Processes operations sequentially in FIFO order (by sequence_number)
   * Continues processing even if individual operations fail
   *
   * @returns PushResult with statistics
   */
  async pushOperations(): Promise<PushResult> {
    const result: PushResult = {
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      errors: [],
    };

    // Get all pending operations sorted by sequence_number (FIFO)
    const operations = await this.db.getPendingOperations();

    // Process each operation sequentially
    for (const operation of operations) {
      result.processedCount++;

      try {
        await this.processOperation(operation);
        result.successCount++;
      } catch (error) {
        result.failedCount++;
        result.errors.push({
          operationId: operation.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        logger.error(`Failed to sync operation ${operation.id}:`, error);
      }
    }

    return result;
  }

  /**
   * Process a single operation by dispatching to appropriate handler
   *
   * @param operation The outbox operation to process
   */
  private async processOperation(operation: OutboxOperation): Promise<void> {
    // Mark as syncing
    await this.db.markOperationSyncing(operation.id);

    try {
      // Dispatch to appropriate handler based on entity_type and operation_type
      if (operation.entity_type === "pre_order") {
        switch (operation.operation_type) {
          case "CREATE":
            await this.handlePreOrderCreate(operation);
            break;
          case "UPDATE":
            await this.handlePreOrderUpdate(operation);
            break;
          case "DELETE":
            await this.handlePreOrderDelete(operation);
            break;
        }
      } else if (operation.entity_type === "pre_order_flow") {
        switch (operation.operation_type) {
          case "CREATE":
            await this.handlePreOrderFlowCreate(operation);
            break;
          case "UPDATE":
            await this.handlePreOrderFlowUpdate(operation);
            break;
          case "DELETE":
            await this.handlePreOrderFlowDelete(operation);
            break;
        }
      }

      // Mark as synced on success
      await this.db.markOperationSynced(operation.id);
    } catch (error) {
      // Mark as failed on error
      await this.db.markOperationFailed(operation.id);
      throw error;
    }
  }

  /**
   * Handle CREATE operation for pre_order
   */
  private async handlePreOrderCreate(
    operation: OutboxOperation,
  ): Promise<void> {
    const data = operation.data as any; // TODO: add dto type

    await api.createPreOrder({
      partner_id: data.partner_id,
      delivery_date: data.delivery_date,
      status: data.status,
      comment: data.comment,
    });
  }

  /**
   * Handle UPDATE operation for pre_order
   */
  private async handlePreOrderUpdate(
    operation: OutboxOperation,
  ): Promise<void> {
    const data = operation.data as any; // TODO: add dto type

    await api.updatePreOrder(operation.entity_id, data);
  }

  /**
   * Handle DELETE operation for pre_order
   */
  private async handlePreOrderDelete(
    operation: OutboxOperation,
  ): Promise<void> {
    await api.deletePreOrder(operation.entity_id);
  }

  /**
   * Handle CREATE operation for pre_order_flow
   */
  private async handlePreOrderFlowCreate(
    operation: OutboxOperation,
  ): Promise<void> {
    const data = operation.data as any; // TODO: add dto type

    const preOrderId = data.pre_order_id;

    await api.createFlow(preOrderId, {
      product_id: data.product_id,
      unit_id: data.unit_id,
      quantity: data.quantity,
      price: data.price,
      comment: data.comment,
    });
  }

  /**
   * Handle UPDATE operation for pre_order_flow
   */
  private async handlePreOrderFlowUpdate(
    operation: OutboxOperation,
  ): Promise<void> {
    const data = operation.data as any; // TODO: add dto type

    await api.updateFlow(operation.entity_id, data);
  }

  /**
   * Handle DELETE operation for pre_order_flow
   */
  private async handlePreOrderFlowDelete(
    operation: OutboxOperation,
  ): Promise<void> {
    await api.deleteFlow(operation.entity_id);
  }
}
