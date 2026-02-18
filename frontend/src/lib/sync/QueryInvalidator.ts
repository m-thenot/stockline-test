import type { QueryClient } from "@tanstack/react-query";
import { logger } from "@/lib/utils/logger";
import type { RecapGroup } from "@/lib/types";

class QueryInvalidator {
  private queryClient: QueryClient | null = null;

  registerQueryClient(client: QueryClient): void {
    this.queryClient = client;
  }

  private ensureClient(): QueryClient | null {
    if (!this.queryClient) {
      logger.warn("QueryClient not registered, skipping query invalidation");
      return null;
    }
    return this.queryClient;
  }

  /**
   * Invalidate recap queries whose cached data contains any of the given preOrderIds.
   */
  invalidatePreOrdersByIds(preOrderIds: string[]): void {
    const client = this.ensureClient();
    if (!client || preOrderIds.length === 0) return;

    const idsSet = new Set(preOrderIds);

    client.invalidateQueries({
      queryKey: ["recap"],
      predicate: (query) => {
        const data = query.state.data as RecapGroup[] | undefined;
        if (!data || !Array.isArray(data)) return false;

        const queryPreOrderIds = new Set<string>();
        for (const group of data) {
          for (const po of group.pre_orders) {
            queryPreOrderIds.add(po.id);
          }
        }

        for (const id of idsSet) {
          if (queryPreOrderIds.has(id)) return true;
        }
        return false;
      },
    });
    logger.debug(
      `Invalidated recap queries containing preOrderIds: ${preOrderIds.length} ids`,
    );
  }

  invalidateAll(): void {
    const client = this.ensureClient();
    if (!client) return;

    const keys = ["units", "products", "partners", "recap"] as const;

    keys.forEach((key) => {
      client.invalidateQueries({ queryKey: [key] });
    });

    logger.debug("Invalidated all recap queries");
  }
}

export const queryInvalidator = new QueryInvalidator();
