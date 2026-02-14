import { Repository } from "../repository";
import type { PreOrderFlow } from "../models";
import type { SyncDB } from "../index";

/**
 * Repository for PreOrderFlow entities (line items)
 * Provides CRUD operations and custom query methods
 */
export class PreOrderFlowRepository extends Repository<PreOrderFlow> {
  constructor(db: SyncDB) {
    super(db, "pre_order_flows", "flow");
  }

  /**
   * Get all flows (line items) for a specific pre-order
   * This is efficient as pre_order_id has an index
   *
   * @param preOrderId PreOrder UUID
   * @returns Array of flows for the pre-order
   */
  async getByPreOrderId(preOrderId: string): Promise<PreOrderFlow[]> {
    return await this.db.pre_order_flows
      .where("pre_order_id")
      .equals(preOrderId)
      .toArray();
  }

  /**
   * Delete all flows for a specific pre-order
   * Each delete is recorded in the outbox individually
   *
   * @param preOrderId PreOrder UUID
   * @returns Promise that resolves when all flows are deleted
   */
  async deleteByPreOrderId(preOrderId: string): Promise<void> {
    const flows = await this.getByPreOrderId(preOrderId);

    // Delete each flow individually (records each delete in outbox)
    for (const flow of flows) {
      await this.delete(flow.id);
    }
  }

  /**
   * Get all flows for a specific product across all pre-orders
   *
   * @param productId Product UUID
   * @returns Array of flows for the product
   */
  async getByProductId(productId: string): Promise<PreOrderFlow[]> {
    return await this.db.pre_order_flows
      .where("product_id")
      .equals(productId)
      .toArray();
  }

  /**
   * Calculate total quantity for a product across all pre-orders
   *
   * @param productId Product UUID
   * @returns Total quantity ordered
   */
  async getTotalQuantityForProduct(productId: string): Promise<number> {
    const flows = await this.getByProductId(productId);
    return flows.reduce((sum, flow) => sum + flow.quantity, 0);
  }
}
