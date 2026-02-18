import type { SyncDB } from "@/lib/db";
import type { OutboxOperation } from "@/lib/db/models";
import { api } from "@/lib/api";
import { logger } from "@/lib/utils/logger";
import { queryInvalidator } from "./QueryInvalidator";
import type {
  PushOperationRequest,
  PushResult,
  PushOperationResult,
} from "./types";

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

    // Coalesce redundant operations before pushing
    const { toSend, toRemoveIds } = this.coalesceOperations(operations);

    // Mark coalesced-away operations as synced immediately
    if (toRemoveIds.length > 0) {
      await this.db.markOperationsSynced(toRemoveIds);
      logger.info(
        `Coalesced ${toRemoveIds.length} redundant operations (${operations.length} → ${toSend.length})`,
      );
    }

    // All operations cancelled out (e.g. CREATE + DELETE)
    if (toSend.length === 0) {
      result.successCount = operations.length;
      return result;
    }

    // Map outbox entries to the push request format
    const pushOperations = toSend.map(this.toPushOperation);

    // Mark remaining as syncing in batch
    const ids = toSend.map((op) => op.id);
    await this.db.markOperationsSyncing(ids);

    try {
      const response = await api.syncPush({ operations: pushOperations });

      // Build a lookup from operation_id -> outbox operation for entity updates
      const outboxById = new Map(toSend.map((op) => [op.id, op]));

      // Process all results in parallel
      const processResults = await Promise.allSettled(
        response.results.map((opResult) =>
          this.processOperationResult(opResult, outboxById),
        ),
      );

      // Collect results and affected pre_order IDs for cache invalidation
      const affectedPreOrderIds = new Set<string>();

      for (let i = 0; i < processResults.length; i++) {
        const settledResult = processResults[i];
        const opResult = response.results[i];

        if (settledResult.status === "fulfilled") {
          const { success, affectedPreOrderId } = settledResult.value;

          if (success) {
            result.successCount++;

            // Track pre_order IDs for cache invalidation
            if (affectedPreOrderId) {
              affectedPreOrderIds.add(affectedPreOrderId);
            }
          } else {
            result.failedCount++;
            result.errors.push({
              operationId: opResult.operation_id,
              error: new Error(opResult.message ?? "Unknown server error"),
            });
          }
        } else {
          // Promise rejected (unexpected error during processing)
          result.failedCount++;
          result.errors.push({
            operationId: opResult.operation_id,
            error: settledResult.reason,
          });
          logger.error(
            `Failed to process operation result ${opResult.operation_id}:`,
            settledResult.reason,
          );
        }
      }

      // Invalidate cache for affected pre_orders
      if (affectedPreOrderIds.size > 0) {
        queryInvalidator.invalidatePreOrdersByIds(
          Array.from(affectedPreOrderIds),
        );
      }

      // Update last push timestamp
      if (result.successCount > 0) {
        await this.db.metadata.put({
          key: "last_push_timestamp",
          value: new Date().toISOString(),
        });
      }
    } catch (error) {
      // Network or unexpected error (timeout, 500, 503, etc.)
      // These are retryable errors — mark ops as failed with exponential backoff
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      for (const op of toSend) {
        await this.db.markOperationFailed(op.id, errorMessage);
      }
      result.failedCount = toSend.length;
      result.successCount = 0;
      result.errors.push({
        operationId: "batch",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      logger.error("Batch push failed (network error, will retry):", error);
    }

    return result;
  }

  /**
   * Coalesce redundant operations targeting the same entity before pushing.
   *
   * Rules (applied per entity_type + entity_id group, ordered by sequence_number):
   *  - CREATE + UPDATE(s)       → single CREATE with merged data
   *  - CREATE + ... + DELETE    → all operations cancel out (nothing to send)
   *  - Multiple UPDATEs         → single UPDATE with merged data, first expected_version
   */
  private coalesceOperations(operations: OutboxOperation[]): {
    toSend: OutboxOperation[];
    toRemoveIds: string[];
  } {
    // Group operations by (entity_type, entity_id), preserving sequence order
    const groups = new Map<string, OutboxOperation[]>();
    for (const op of operations) {
      const key = `${op.entity_type}:${op.entity_id}`;
      const group = groups.get(key);
      if (group) {
        group.push(op);
      } else {
        groups.set(key, [op]);
      }
    }

    const toSend: OutboxOperation[] = [];
    const toRemoveIds: string[] = [];

    for (const group of groups.values()) {
      if (group.length === 1) {
        // Single operation — pass through unchanged
        toSend.push(group[0]);
        continue;
      }

      const first = group[0];
      const last = group[group.length - 1];

      if (
        first.operation_type === "CREATE" &&
        last.operation_type === "DELETE"
      ) {
        // CREATE + ... + DELETE → everything cancels out
        for (const op of group) {
          toRemoveIds.push(op.id);
        }
        continue;
      }

      if (first.operation_type === "CREATE") {
        // CREATE + UPDATE(s) → merge updates into the CREATE
        let mergedData = { ...(first.data as Record<string, unknown>) };

        for (let i = 1; i < group.length; i++) {
          const updateData = { ...(group[i].data as Record<string, unknown>) };
          // Strip the version from UPDATE data — CREATE already carries the right version
          delete updateData.version;
          mergedData = { ...mergedData, ...updateData };
          toRemoveIds.push(group[i].id);
        }

        toSend.push({
          ...first,
          data: mergedData,
          timestamp: last.timestamp,
        });
        continue;
      }

      // Multiple UPDATEs
      // Find consecutive UPDATEs from the start
      const updates: OutboxOperation[] = [];
      let rest: OutboxOperation[] = [];
      for (let i = 0; i < group.length; i++) {
        if (group[i].operation_type === "UPDATE") {
          updates.push(group[i]);
        } else {
          rest = group.slice(i);
          break;
        }
      }

      // Check if there's a DELETE at the end (after UPDATEs)
      const endsWithDelete =
        rest.length > 0 && rest[rest.length - 1].operation_type === "DELETE";

      if (endsWithDelete) {
        // UPDATE(s) + ... + DELETE → keep only DELETE, discard all UPDATEs
        // UPDATEs are redundant since the entity will be deleted
        for (const update of updates) {
          toRemoveIds.push(update.id);
        }
        // Pass through the DELETE (and any other operations in rest)
        for (const op of rest) {
          toSend.push(op);
        }
      } else {
        // Normal UPDATE merging logic (no DELETE at the end)
        if (updates.length > 1) {
          // Merge all UPDATEs into the first one
          const firstUpdate = updates[0];
          let mergedData = { ...(firstUpdate.data as Record<string, unknown>) };

          for (let i = 1; i < updates.length; i++) {
            const laterData = {
              ...(updates[i].data as Record<string, unknown>),
            };
            // Strip version from later UPDATEs — keep the first UPDATE's expected_version
            delete laterData.version;
            mergedData = { ...mergedData, ...laterData };
            toRemoveIds.push(updates[i].id);
          }

          toSend.push({
            ...firstUpdate,
            data: mergedData,
            timestamp: updates[updates.length - 1].timestamp,
          });
        } else if (updates.length === 1) {
          toSend.push(updates[0]);
        }

        // Pass through any trailing non-UPDATE operations
        for (const op of rest) {
          toSend.push(op);
        }
      }
    }

    return { toSend, toRemoveIds };
  }

  /**
   * Process a single operation result from the server
   * Handles success, conflicts, and rejections
   *
   * @returns Object with success flag and affected pre_order ID (for cache invalidation)
   */
  private async processOperationResult(
    opResult: PushOperationResult,
    outboxById: Map<string, OutboxOperation>,
  ): Promise<{ success: boolean; affectedPreOrderId: string | null }> {
    const outboxOp = outboxById.get(opResult.operation_id);

    console.log("opResult", opResult);

    if (
      opResult.status === "success" ||
      (opResult.status === "conflict" &&
        !(outboxOp?.operation_type === "DELETE"))
    ) {
      // Both success and conflict are considered "handled" by the server
      await this.db.markOperationSynced(opResult.operation_id);

      // Reconcile version in IndexedDB
      if (opResult.new_version != null && outboxOp) {
        await this.db.updateEntityVersion(
          outboxOp.entity_type,
          outboxOp.entity_id,
          opResult.new_version,
        );
      }

      // Handle conflicts - update entity with server values when server wins
      if (opResult.status === "conflict" && opResult.conflicts && outboxOp) {
        const serverUpdates: Record<string, unknown> = {};

        for (const conflict of opResult.conflicts) {
          if (conflict.winner === "server") {
            serverUpdates[conflict.field] = conflict.server_value;
          }
        }

        // Update entity in DB with server values
        if (Object.keys(serverUpdates).length > 0) {
          const table =
            outboxOp.entity_type === "pre_order"
              ? this.db.pre_orders
              : this.db.pre_order_flows;
          await table.update(outboxOp.entity_id, serverUpdates);
        }

        logger.warn(
          `Operation ${opResult.operation_id} resolved with conflicts:`,
          opResult.message,
          opResult.conflicts,
        );
      }

      // Get the pre_order_id for cache invalidation
      const preOrderId = await this.getPreOrderIdForCacheInvalidation(outboxOp);

      return {
        success: true,
        affectedPreOrderId: preOrderId,
      };
    } else {
      // Handle DELETE conflicts - restore entity by setting deleted_at to null
      if (
        opResult.status === "conflict" &&
        outboxOp?.operation_type === "DELETE"
      ) {
        // Restore entity by setting deleted_at to null and updating version
        if (outboxOp.entity_type === "pre_order") {
          const existing = await this.db.pre_orders.get(outboxOp.entity_id);
          if (existing) {
            await this.db.pre_orders.update(outboxOp.entity_id, {
              deleted_at: null,
              version: opResult.new_version ?? existing.version,
              updated_at: new Date().toISOString(),
            });
          }
        } else if (outboxOp.entity_type === "pre_order_flow") {
          const existing = await this.db.pre_order_flows.get(
            outboxOp.entity_id,
          );
          if (existing) {
            await this.db.pre_order_flows.update(outboxOp.entity_id, {
              deleted_at: null,
              version: opResult.new_version ?? existing.version,
              updated_at: new Date().toISOString(),
            });
          }
        }

        logger.warn(
          `DELETE operation ${opResult.operation_id} rejected - entity restored (deleted_at set to null):`,
          opResult.message,
        );
      }

      // Server rejected the operation (permanent error)
      await this.db.markOperationRejected(
        opResult.operation_id,
        opResult.message ?? undefined,
      );
      logger.error(
        `Server rejected operation ${opResult.operation_id} (permanent):`,
        opResult.message,
      );

      return {
        success: false,
        affectedPreOrderId: null,
      };
    }
  }

  /**
   * Get the pre_order_id for cache invalidation
   * For pre_orders: return the entity_id directly
   * For pre_order_flows: extract pre_order_id from the operation data or fetch from DB
   */
  private async getPreOrderIdForCacheInvalidation(
    outboxOp: OutboxOperation | undefined,
  ): Promise<string | null> {
    if (!outboxOp) return null;

    if (outboxOp.entity_type === "pre_order") {
      return outboxOp.entity_id;
    }

    // For pre_order_flow, get the pre_order_id
    if (outboxOp.entity_type === "pre_order_flow") {
      // Try to get pre_order_id from operation data first (works for all operation types)
      const data = outboxOp.data as { pre_order_id?: string } | undefined;
      if (data?.pre_order_id) {
        return data.pre_order_id;
      }

      // Fallback: fetch from DB (only works if flow still exists, not for DELETE)
      try {
        const flow = await this.db.pre_order_flows.get(outboxOp.entity_id);
        return flow?.pre_order_id ?? null;
      } catch (error) {
        logger.warn(
          `Could not get pre_order_id for flow ${outboxOp.entity_id}:`,
          error,
        );
        return null;
      }
    }

    return null;
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
