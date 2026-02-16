import type { SyncDB } from "@/lib/db";
import { api, type SnapshotData } from "@/lib/api";
import { logger } from "@/lib/utils/logger";

export class PullService {
  private isSyncing = false;

  constructor(private db: SyncDB) {}

  public async start(): Promise<void> {
    const hasData = await this.hasLocalData();

    if (!hasData) {
      logger.info("Local DB is empty, fetching initial snapshot...");
      await this.syncInitialSnapshot();
    } else {
      logger.info("Local DB has data, skipping initial sync");
    }
  }

  private async hasLocalData(): Promise<boolean> {
    const lastSync = await this.db.metadata.get("last_sync_timestamp");
    return lastSync !== undefined;
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

      logger.info("Initial snapshot sync completed");
    } catch (error) {
      logger.error("Failed to sync initial snapshot:", error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
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
        data.pre_orders.map((po) => ({ ...po, version: 1 })),
      );
    }

    if (data.flows.length > 0) {
      await this.db.pre_order_flows.bulkPut(
        data.flows.map((f) => ({ ...f, version: 1 })),
      );
    }

    logger.info("Database populated with snapshot data");
  }

  public getStatus(): { syncing: boolean } {
    return { syncing: this.isSyncing };
  }
}
