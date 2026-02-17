import type { SyncDB } from "@/lib/db";
import type { OutboxOperation } from "@/lib/db/models";
import { api } from "@/lib/api";
import { logger } from "@/lib/utils/logger";
import type { PushOperationRequest, PushResult } from "./types";

export class PushService {
  constructor(private db: SyncDB) {}

  /**
   * Push all pending operations to the server as a single batch
   * via POST /sync/push. Handles per-operation results (success/conflict/error).
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

    const operations = await this.db.getPendingOperations();
    if (operations.length === 0) {
      return result;
    }

    result.processedCount = operations.length;

    // Map outbox entries to the push request format
    const pushOperations = operations.map(this.toPushOperation);

    // Mark all as syncing in batch
    const ids = operations.map((op) => op.id);
    await this.db.markOperationsSyncing(ids);

    try {
      const response = await api.syncPush({ operations: pushOperations });

      // Build a lookup from operation_id -> outbox operation for entity updates
      const outboxById = new Map(operations.map((op) => [op.id, op]));

      let maxSyncId = 0;

      for (const opResult of response.results) {
        const outboxOp = outboxById.get(opResult.operation_id);

        if (opResult.status === "success" || opResult.status === "conflict") {
          // Both success and conflict are considered "handled" by the server
          await this.db.markOperationSynced(opResult.operation_id);
          result.successCount++;

          // Reconcile version in IndexedDB
          if (opResult.new_version != null && outboxOp) {
            await this.db.updateEntityVersion(
              outboxOp.entity_type,
              outboxOp.entity_id,
              opResult.new_version,
            );
          }

          // Track highest sync_id
          if (opResult.sync_id != null && opResult.sync_id > maxSyncId) {
            maxSyncId = opResult.sync_id;
          }

          // Log conflict details for observability
          if (opResult.status === "conflict") {
            logger.warn(
              `Operation ${opResult.operation_id} resolved with conflicts:`,
              opResult.message,
              opResult.conflicts,
            );
          }
        } else {
          // error
          await this.db.markOperationFailed(opResult.operation_id);
          result.failedCount++;
          result.errors.push({
            operationId: opResult.operation_id,
            error: new Error(opResult.message ?? "Unknown server error"),
          });
          logger.error(
            `Server rejected operation ${opResult.operation_id}:`,
            opResult.message,
          );
        }
      }

      // Advance the sync cursor
      if (maxSyncId > 0) {
        const currentSyncId = await this.db.getLastSyncId();
        if (maxSyncId > currentSyncId) {
          await this.db.setLastSyncId(maxSyncId);
        }
      }

      // Update last sync timestamp
      if (result.successCount > 0) {
        await this.db.metadata.put({
          key: "last_sync_timestamp",
          value: new Date().toISOString(),
        });
      }
    } catch (error) {
      // Network or unexpected error — mark all back to failed
      for (const op of operations) {
        await this.db.markOperationFailed(op.id);
      }
      result.failedCount = operations.length;
      result.successCount = 0;
      result.errors.push({
        operationId: "batch",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      logger.error("Batch push failed:", error);
    }

    return result;
  }

  /**
   * Convert an OutboxOperation to the PushOperationRequest format
   * expected by POST /sync/push
   */
  private toPushOperation(op: OutboxOperation): PushOperationRequest {
    const data = (op.data ?? {}) as Record<string, unknown>;

    // Extract expected_version from the data payload
    const expectedVersion =
      typeof data.version === "number" ? data.version : null;

    // Strip internal fields that the server doesn't need
    const { version: _, created_at: __, updated_at: ___, ...cleanData } = data;

    return {
      id: op.id,
      entity_type: op.entity_type,
      entity_id: op.entity_id,
      operation_type: op.operation_type,
      data: cleanData,
      expected_version: expectedVersion,
      timestamp: op.timestamp,
    };
  }
}
