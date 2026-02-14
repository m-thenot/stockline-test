import { Repository } from "../repository";
import type { PreOrder } from "../models";
import type { SyncDB } from "../index";

/**
 * Repository for PreOrder entities
 * Provides CRUD operations and custom query methods
 */
export class PreOrderRepository extends Repository<PreOrder> {
  constructor(db: SyncDB) {
    super(db, "pre_orders", "pre_order");
  }

  /**
   * Get all pre-orders for a specific partner
   *
   * @param partnerId Partner UUID
   * @returns Array of pre-orders for the partner
   */
  async getByPartnerId(partnerId: string): Promise<PreOrder[]> {
    return await this.db.pre_orders
      .where("partner_id")
      .equals(partnerId)
      .toArray();
  }

  /**
   * Get all pre-orders for a specific delivery date
   *
   * @param deliveryDate ISO 8601 date string (e.g., "2024-06-15")
   * @returns Array of pre-orders for the delivery date
   */
  async getByDeliveryDate(deliveryDate: string): Promise<PreOrder[]> {
    return await this.db.pre_orders
      .where("delivery_date")
      .equals(deliveryDate)
      .toArray();
  }

  /**
   * Get all pre-orders with a specific status
   *
   * @param status Status string (e.g., "draft", "confirmed")
   * @returns Array of pre-orders with the status
   */
  async getByStatus(status: string): Promise<PreOrder[]> {
    return await this.db.pre_orders.where("status").equals(status).toArray();
  }

  /**
   * Get all pre-orders sorted by creation date (newest first)
   * This is more efficient as it uses the created_at index
   *
   * @returns Array of pre-orders sorted by creation date descending
   */
  async getAllSortedByDate(): Promise<PreOrder[]> {
    return await this.db.pre_orders.orderBy("created_at").reverse().toArray();
  }
}
