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

          // Log conflict details for observability
          if (opResult.status === "conflict") {
            logger.warn(
              `Operation ${opResult.operation_id} resolved with conflicts:`,
              opResult.message,
              opResult.conflicts,
            );
          }
        } else {
          await this.db.markOperationRejected(
            opResult.operation_id,
            opResult.message ?? undefined,
          );
          result.failedCount++;
          result.errors.push({
            operationId: opResult.operation_id,
            error: new Error(opResult.message ?? "Unknown server error"),
          });
          logger.error(
            `Server rejected operation ${opResult.operation_id} (permanent):`,
            opResult.message,
          );
        }
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
