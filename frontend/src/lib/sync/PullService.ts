import type { SyncDB } from "@/lib/db";
import type { EntityType, OutboxOperation } from "@/lib/db/models";
import { api, type SnapshotData } from "@/lib/api";
import { logger } from "@/lib/utils/logger";
import type { PreOrder, PreOrderFlow } from "@/lib/db/models";
import type { PullOperation } from "./types";
import { queryInvalidator } from "./QueryInvalidator";

export class PullService {
  private isSyncing = false;

  constructor(private db: SyncDB) {}

  // Fields that can be updated for PreOrder (excluding id, version, timestamps)
  private readonly PRE_ORDER_UPDATEABLE_FIELDS: (keyof PreOrder)[] = [
    "partner_id",
    "status",
    "order_date",
    "delivery_date",
    "comment",
  ];

  // Fields that can be updated for PreOrderFlow (excluding id, version, timestamps)
  private readonly PRE_ORDER_FLOW_UPDATEABLE_FIELDS: (keyof PreOrderFlow)[] = [
    "pre_order_id",
    "product_id",
    "unit_id",
    "quantity",
    "price",
    "comment",
  ];

  public async start(): Promise<void> {
    const hasData = await this.hasLocalData();

    if (!hasData) {
      logger.info("Local DB is empty, fetching initial snapshot...");
      await this.syncInitialSnapshot();
    } else {
      logger.info("Local DB has data, skipping initial sync");
    }
  }

  public async syncInitialSnapshot(): Promise<void> {
    if (this.isSyncing) {
      logger.warn("Sync already in progress");
      return;
    }

    this.isSyncing = true;

    try {
      const data = await api.getSnapshot();

      logger.info("Snapshot received:", {
        partners: data.partners.length,
        products: data.products.length,
        units: data.units.length,
        pre_orders: data.pre_orders.length,
        flows: data.flows.length,
      });

      await this.populateDatabase(data);

      await this.db.metadata.put({
        key: "last_sync_timestamp",
        value: Date.now(),
      });

      queryInvalidator.invalidateAll();

      logger.info("Initial snapshot sync completed");
    } catch (error) {
      logger.error("Failed to sync initial snapshot:", error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Pull incremental operations from the server since the last sync_id.
   * Applies operations to IndexedDB with rebase for local pending operations.
   * Updates the sync cursor.
   */
  public async pullIncremental(): Promise<void> {
    if (this.isSyncing) {
      logger.warn("Pull sync already in progress");
      return;
    }

    this.isSyncing = true;
    const pendingOps = await this.db.getPendingOperations();
    const pendingByEntity = this.groupPendingOpsByEntity(pendingOps);

    // Track modified preOrderIds for query invalidation
    const affectedPreOrderIds = new Set<string>();

    try {
      let sinceSyncId = await this.db.getLastSyncId();
      let hasMore = true;
      let maxSyncId = sinceSyncId;

      while (hasMore) {
        const response = await api.pullOperations(sinceSyncId, 100);

        if (response.operations.length === 0) {
          break;
        }

        // Apply each operation to IndexedDB with rebase if needed
        for (const op of response.operations) {
          const entityKey = `${op.entity_type}:${op.entity_id}`;
          const localOps = pendingByEntity.get(entityKey) || [];

          // Track affected preOrderIds (for flows, get pre_order_id from data or DB)
          if (op.entity_type === "pre_order") {
            affectedPreOrderIds.add(op.entity_id);
          } else if (op.entity_type === "pre_order_flow") {
            const preOrderId =
              (op.data?.pre_order_id as string | undefined) ??
              (await this.db.pre_order_flows.get(op.entity_id))?.pre_order_id;
            if (preOrderId) affectedPreOrderIds.add(preOrderId);
          }

          if (localOps.length > 0) {
            // Potential conflict: there are local operations pending
            await this.rebaseEntity(op, localOps);
          } else {
            await this.applyOperation(op);
          }

          maxSyncId = Math.max(maxSyncId, op.sync_id);
        }

        // Update sync cursor
        await this.db.setLastSyncId(maxSyncId);

        hasMore = response.has_more;
        sinceSyncId = maxSyncId;

        logger.info(
          `Pulled ${response.operations.length} operations (sync_id ${maxSyncId})`,
        );
      }

      // Invalidate queries by preOrderIds (no delivery_date lookup)
      if (affectedPreOrderIds.size > 0) {
        queryInvalidator.invalidatePreOrdersByIds(
          Array.from(affectedPreOrderIds),
        );
      }

      // Update last sync timestamp
      await this.db.metadata.put({
        key: "last_sync_timestamp",
        value: Date.now(),
      });

      logger.info("Incremental pull completed");
    } catch (error) {
      logger.error("Failed to pull incremental operations:", error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  public getStatus(): { syncing: boolean } {
    return { syncing: this.isSyncing };
  }

  private async hasLocalData(): Promise<boolean> {
    const lastSync = await this.db.metadata.get("last_sync_timestamp");
    return lastSync !== undefined;
  }

  private async populateDatabase(data: SnapshotData): Promise<void> {
    if (data.partners.length > 0) {
      await this.db.partners.bulkPut(data.partners);
    }

    if (data.products.length > 0) {
      await this.db.products.bulkPut(data.products);
    }

    if (data.units.length > 0) {
      await this.db.units.bulkPut(data.units);
    }

    if (data.pre_orders.length > 0) {
      await this.db.pre_orders.bulkPut(
        data.pre_orders.map((po) => ({
          ...po,
          version: 1,
          deleted_at: po.deleted_at ?? null,
        })),
      );
    }

    if (data.flows.length > 0) {
      await this.db.pre_order_flows.bulkPut(
        data.flows.map((f) => ({
          ...f,
          version: 1,
          deleted_at: f.deleted_at ?? null,
        })),
      );
    }

    logger.info("Database populated with snapshot data");
  }

  /**
   * Group pending operations by entity (entity_type:entity_id).
   */
  private groupPendingOpsByEntity(
    pendingOps: OutboxOperation[],
  ): Map<string, OutboxOperation[]> {
    const grouped = new Map<string, OutboxOperation[]>();
    for (const op of pendingOps) {
      const key = `${op.entity_type}:${op.entity_id}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(op);
    }
    return grouped;
  }

  /**
   * Rebase local pending operations when server changes arrive.
   * Process:
   * 1. Apply server operation (source of truth)
   * 2. Re-apply local operations on DB
   */
  private async rebaseEntity(
    serverOp: PullOperation,
    localOps: OutboxOperation[],
  ): Promise<void> {
    logger.info(
      `Rebasing ${localOps.length} local operations for ${serverOp.entity_type}:${serverOp.entity_id}`,
    );

    // 1. Apply server operation (source of truth)
    await this.applyOperation(serverOp);

    // 2. Check if entity still exists (might have been deleted)
    const entity = await this.getEntity(
      serverOp.entity_type,
      serverOp.entity_id,
    );

    if (!entity) {
      // Entity was deleted by server operation
      // Local operations on deleted entity will be rejected by server
      logger.warn(
        `Entity ${serverOp.entity_type}:${serverOp.entity_id} was deleted by server, ${localOps.length} local operations will be rejected on push`,
      );
      return;
    }

    // 3. Re-apply local operations on DB (for UX preview only)
    // This lets the user see their changes applied, but doesn't affect conflict resolution
    // The server will resolve conflicts with LWW when these operations are pushed
    for (const localOp of localOps) {
      await this.reapplyLocalOperation(localOp);
    }

    logger.debug(
      `Re-applied ${localOps.length} local operations on DB (UX preview). Outbox unchanged - server will resolve conflicts.`,
    );
  }

  /**
   * Re-apply a local operation to the DB
   */
  private async reapplyLocalOperation(localOp: OutboxOperation): Promise<void> {
    const { entity_type, entity_id, operation_type, data } = localOp;

    if (operation_type === "UPDATE") {
      await this.reapplyLocalUpdate(entity_type, entity_id, data);
    } else if (operation_type === "DELETE") {
      await this.reapplyLocalDelete(entity_type, entity_id);
    }
  }

  /**
   * Re-apply a local UPDATE operation to the DB.
   * Merges the update data with the current entity state.
   */
  private async reapplyLocalUpdate(
    entityType: EntityType,
    entityId: string,
    data: unknown,
  ): Promise<void> {
    const updateData = data as Record<string, unknown>;

    if (entityType === "pre_order") {
      const existing = await this.db.pre_orders.get(entityId);
      if (!existing) {
        logger.warn(
          `PreOrder ${entityId} not found for rebase update, skipping`,
        );
        return;
      }

      const updates = this.pickFields<PreOrder>(
        updateData,
        this.PRE_ORDER_UPDATEABLE_FIELDS,
      );

      // Don't update version or timestamps - keep server's values
      if (Object.keys(updates).length > 0) {
        await this.db.pre_orders.update(entityId, updates);
      }
    } else if (entityType === "pre_order_flow") {
      const existing = await this.db.pre_order_flows.get(entityId);
      if (!existing) {
        logger.warn(`Flow ${entityId} not found for rebase update, skipping`);
        return;
      }

      const updates = this.pickFields<PreOrderFlow>(
        updateData,
        this.PRE_ORDER_FLOW_UPDATEABLE_FIELDS,
      );

      if (Object.keys(updates).length > 0) {
        await this.db.pre_order_flows.update(entityId, updates);
      }
    }
  }

  /**
   * Re-apply a local DELETE operation to the DB.
   * Soft deletes the entity (sets deleted_at timestamp).
   */
  private async reapplyLocalDelete(
    entityType: EntityType,
    entityId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    if (entityType === "pre_order") {
      const existing = await this.db.pre_orders.get(entityId);
      if (existing) {
        await this.db.pre_orders.update(entityId, {
          deleted_at: now,
          version: existing.version + 1,
          updated_at: now,
        });
        // Also soft delete associated flows
        const flows = await this.db.pre_order_flows
          .where("pre_order_id")
          .equals(entityId)
          .toArray();
        for (const flow of flows) {
          await this.db.pre_order_flows.update(flow.id, {
            deleted_at: now,
            version: flow.version + 1,
            updated_at: now,
          });
        }
      }
    } else if (entityType === "pre_order_flow") {
      const existing = await this.db.pre_order_flows.get(entityId);
      if (existing) {
        await this.db.pre_order_flows.update(entityId, {
          deleted_at: now,
          version: existing.version + 1,
          updated_at: now,
        });
      }
    }
  }

  /**
   * Get entity by type and ID to retrieve its version after server update.
   */
  private async getEntity(
    entityType: string,
    entityId: string,
  ): Promise<{ version: number } | null> {
    if (entityType === "pre_order") {
      const entity = await this.db.pre_orders.get(entityId);
      return entity ? { version: entity.version } : null;
    } else if (entityType === "pre_order_flow") {
      const entity = await this.db.pre_order_flows.get(entityId);
      return entity ? { version: entity.version } : null;
    }
    return null;
  }

  /**
   * Apply a single operation from the server to IndexedDB.
   */
  private async applyOperation(op: PullOperation): Promise<void> {
    const { entity_type, entity_id, operation_type, data } = op;

    if (entity_type === "pre_order") {
      await this.applyPreOrderOperation(entity_id, operation_type, data);
    } else if (entity_type === "pre_order_flow") {
      await this.applyFlowOperation(entity_id, operation_type, data);
    } else {
      logger.warn(`Unknown entity_type: ${entity_type}`);
    }
  }

  /**
   * Apply a PreOrder operation (CREATE/UPDATE/DELETE).
   */
  private async applyPreOrderOperation(
    entityId: string,
    operationType: "CREATE" | "UPDATE" | "DELETE",
    data: Record<string, unknown>,
  ): Promise<void> {
    if (operationType === "CREATE") {
      // CREATE: full entity data
      const version = (data.version as number) ?? 1;
      const preOrder = {
        id: entityId,
        partner_id: String(data.partner_id),
        status: Number(data.status ?? 0),
        order_date: (data.order_date as string) || null,
        delivery_date: String(data.delivery_date),
        comment: (data.comment as string) || null,
        created_at: (data.created_at as string) || null,
        updated_at: (data.updated_at as string) || null,
        version,
        deleted_at: (data.deleted_at as string) || null,
      };

      await this.db.pre_orders.put(preOrder);
    } else if (operationType === "UPDATE") {
      // UPDATE: merge changes with existing entity
      const existing = await this.db.pre_orders.get(entityId);
      if (!existing) {
        logger.warn(`PreOrder ${entityId} not found for UPDATE, skipping`);
        return;
      }

      const updates: Partial<PreOrder> = {
        version: (data.version as number) ?? existing.version,
        ...this.pickFields<PreOrder>(data, this.PRE_ORDER_UPDATEABLE_FIELDS),
      };

      // Also handle updated_at if present (from server operations)
      if (data.updated_at !== undefined) {
        updates.updated_at = (data.updated_at as string) || null;
      }

      // Handle deleted_at if present (from server operations)
      if (data.deleted_at !== undefined) {
        updates.deleted_at = (data.deleted_at as string) || null;
      }

      await this.db.pre_orders.update(entityId, updates);
    } else if (operationType === "DELETE") {
      // Soft delete: set deleted_at timestamp
      const now = new Date().toISOString();
      const existing = await this.db.pre_orders.get(entityId);
      if (existing) {
        await this.db.pre_orders.update(entityId, {
          deleted_at: now,
          version: existing.version + 1,
          updated_at: now,
        });
        // Also soft delete associated flows
        const flows = await this.db.pre_order_flows
          .where("pre_order_id")
          .equals(entityId)
          .toArray();
        for (const flow of flows) {
          await this.db.pre_order_flows.update(flow.id, {
            deleted_at: now,
            version: flow.version + 1,
            updated_at: now,
          });
        }
      }
    }
  }

  /**
   * Apply a PreOrderFlow operation (CREATE/UPDATE/DELETE).
   */
  private async applyFlowOperation(
    entityId: string,
    operationType: "CREATE" | "UPDATE" | "DELETE",
    data: Record<string, unknown>,
  ): Promise<void> {
    if (operationType === "CREATE") {
      // CREATE: full entity data
      const version = (data.version as number) ?? 1;
      const flow = {
        id: entityId,
        pre_order_id: String(data.pre_order_id),
        product_id: String(data.product_id),
        unit_id: String(data.unit_id),
        quantity: Number(data.quantity ?? 0),
        price: Number(data.price ?? 0),
        comment: (data.comment as string) || null,
        created_at: (data.created_at as string) || null,
        updated_at: (data.updated_at as string) || null,
        version,
        deleted_at: (data.deleted_at as string) || null,
      };

      await this.db.pre_order_flows.put(flow);
    } else if (operationType === "UPDATE") {
      // UPDATE: merge changes with existing entity
      const existing = await this.db.pre_order_flows.get(entityId);
      if (!existing) {
        logger.warn(`Flow ${entityId} not found for UPDATE, skipping`);
        return;
      }

      const updates: Partial<PreOrderFlow> = {
        version: (data.version as number) ?? existing.version,
        ...this.pickFields<PreOrderFlow>(
          data,
          this.PRE_ORDER_FLOW_UPDATEABLE_FIELDS,
        ),
      };

      // Also handle updated_at if present (from server operations)
      if (data.updated_at !== undefined) {
        updates.updated_at = (data.updated_at as string) || null;
      }

      // Handle deleted_at if present (from server operations)
      if (data.deleted_at !== undefined) {
        updates.deleted_at = (data.deleted_at as string) || null;
      }

      await this.db.pre_order_flows.update(entityId, updates);
    } else if (operationType === "DELETE") {
      // Soft delete: set deleted_at timestamp
      const now = new Date().toISOString();
      const existing = await this.db.pre_order_flows.get(entityId);
      if (existing) {
        await this.db.pre_order_flows.update(entityId, {
          deleted_at: now,
          version: existing.version + 1,
          updated_at: now,
        });
      }
    }
  }

  /**
   * Extract only specified fields from source object if they exist.
   * Returns a partial object with only the fields that are present in source.
   * No type conversions needed - IndexedDB/Dexie preserves types correctly.
   */
  private pickFields<T>(
    source: Record<string, unknown>,
    fields: (keyof T)[],
  ): Partial<T> {
    const result: Partial<T> = {};
    for (const field of fields) {
      const fieldStr = String(field);
      if (fieldStr in source && source[fieldStr] !== undefined) {
        (result as Record<string, unknown>)[fieldStr] = source[fieldStr];
      }
    }
    return result;
  }
}
