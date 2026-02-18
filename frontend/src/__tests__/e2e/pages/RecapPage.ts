import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export class RecapPage {
  constructor(public page: Page) {}

  async navigate() {
    await this.page.goto("/recap");
    await expect(this.page.getByTestId("recap-heading")).toBeVisible();
    await expect(this.page.getByTestId("add-order-button")).toBeVisible();
  }

  /**
   * Create a new order: open dialog, select first partner, set delivery date, submit.
   * Caller must set dialog handler before calling if needed. Returns partner name for assertions.
   */
  async createOrder(options?: { deliveryDate?: string }): Promise<{
    partnerName: string;
  }> {
    await this.page.getByTestId("add-order-button").click();
    await expect(this.page.getByTestId("add-order-dialog")).toBeVisible();

    const partnerSelect = this.page.getByTestId("add-order-partner-select");
    await partnerSelect.click();

    await expect(this.page.locator('[role="option"]').first()).toBeVisible({
      timeout: 5000,
    });
    const firstPartner = this.page.locator('[role="option"]').first();
    const partnerName = await firstPartner.textContent();
    if (!partnerName?.trim()) {
      throw new Error("Expected partner name from first option");
    }
    await firstPartner.click();
    await expect(this.page.locator('[role="option"]').first()).not.toBeVisible({
      timeout: 2000,
    });

    const today = new Date().toISOString().split("T")[0];
    const deliveryDate = options?.deliveryDate ?? today;
    await this.page.getByTestId("add-order-delivery-date").fill(deliveryDate);

    await this.page.getByTestId("add-order-create-button").click();

    return { partnerName: partnerName.trim() };
  }

  /**
   * Add a flow to an order by order id suffix (last 8 chars of order id).
   * Selects first product and first unit.
   */
  async addFlowToOrder(
    orderIdSuffix: string,
    params: { quantity: string; price: string },
  ) {
    const productSelect = this.page.getByTestId(
      `add-flow-product-select-${orderIdSuffix}`,
    );
    await productSelect.click();
    await expect(this.page.locator('[role="option"]').first()).toBeVisible({
      timeout: 5000,
    });
    await this.page.locator('[role="option"]').first().click();

    await this.page
      .getByTestId(`add-flow-quantity-input-${orderIdSuffix}`)
      .fill(params.quantity);

    const unitSelect = this.page.getByTestId(
      `add-flow-unit-select-${orderIdSuffix}`,
    );
    await unitSelect.click();
    await expect(this.page.locator('[role="option"]').first()).toBeVisible({
      timeout: 5000,
    });
    await this.page.locator('[role="option"]').first().click();

    await this.page
      .getByTestId(`add-flow-price-input-${orderIdSuffix}`)
      .fill(params.price);

    await this.page.getByTestId(`add-flow-button-${orderIdSuffix}`).click();
  }

  /**
   * Get the order id (data-order-id) of the first order card.
   * Caller must ensure at least one order is visible (e.g. wait for delete button).
   */
  async getFirstOrderId(): Promise<string | null> {
    const deleteButton = this.page.getByTestId("order-delete-button").first();
    return deleteButton
      .locator("xpath=ancestor::*[@data-order-id]")
      .getAttribute("data-order-id");
  }

  /**
   * Click the first order's delete button. Caller must set page.once("dialog", ...) before calling.
   * Returns the order id of the deleted order for API assertions.
   */
  async deleteFirstOrder(): Promise<string> {
    const deleteButton = this.page.getByTestId("order-delete-button").first();
    const orderId = await deleteButton
      .locator("xpath=ancestor::*[@data-order-id]")
      .getAttribute("data-order-id");
    if (!orderId) {
      throw new Error("Could not get data-order-id from first order card");
    }
    await deleteButton.click();
    return orderId;
  }

  /**
   * Click the status badge for an order (toggle Pending/Confirmed) by order id suffix.
   */
  async clickStatusBadge(orderIdSuffix: string) {
    await this.page
      .getByTestId(`order-status-badge-${orderIdSuffix}`)
      .first()
      .click();
  }
}
