import { test, expect } from "@playwright/test";
import { NetworkSimulator } from "./helpers/NetworkSimulator";
import { DatabaseHelpers } from "./helpers/DatabaseHelpers";
import { E2E_API_URL } from "./config";

test.describe("Offline → Online Workflow", () => {
  let networkSimulator: NetworkSimulator;
  let dbHelpers: DatabaseHelpers;

  test.beforeEach(async ({ page }) => {
    networkSimulator = new NetworkSimulator();
    dbHelpers = new DatabaseHelpers();

    // Navigate to recap page first
    await page.goto("/recap");
    // Wait for page to load
    await expect(page.getByTestId("recap-heading")).toBeVisible();
    await expect(page.getByTestId("add-order-button")).toBeVisible();
    await page.waitForTimeout(2000);
  });

  test.afterEach(async ({ page }) => {
    // Reset network state
    await networkSimulator.reset(page);
  });

  test("should create order offline and sync when online", async ({ page }) => {
    // Step 1: Set network to offline
    await networkSimulator.setOffline(page);

    // Step 2: Create a new pre-order via UI
    // Click "Add Order" button
    await page.getByTestId("add-order-button").click();

    // Wait for dialog to appear
    await expect(page.getByTestId("add-order-dialog")).toBeVisible();

    // Select partner from dropdown
    const partnerSelect = page.getByTestId("add-order-partner-select");
    await partnerSelect.click();

    // Wait for select content to appear and click first option
    await expect(page.locator('[role="option"]').first()).toBeVisible({
      timeout: 5000,
    });
    const firstPartner = page.locator('[role="option"]').first();
    const partnerName = await firstPartner.textContent();
    expect(partnerName).toBeTruthy();
    await firstPartner.click();
    // Wait for select to close
    await expect(page.locator('[role="option"]').first()).not.toBeVisible({
      timeout: 2000,
    });

    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split("T")[0];

    // Set delivery date (use today's date)
    await page.getByTestId("add-order-delivery-date").fill(today);

    // Click Create button
    await page.getByTestId("add-order-create-button").click();

    // Step 3: Verify operation is in outbox (status: pending)
    await page.waitForTimeout(500); // Wait for operation to be added to outbox
    const outboxOps = await dbHelpers.getOutboxOperations(page);
    const createOp = outboxOps.find(
      (op) => op.operation_type === "CREATE" && op.entity_type === "pre_order",
    );
    expect(createOp).toBeDefined();
    expect(createOp?.status).toBe("pending");

    const orderIdSuffix = createOp!.entity_id.slice(-8);

    // Step 4: Verify UI shows the new pre-order immediately
    // Dialog should be closed
    await expect(page.getByTestId("add-order-dialog")).not.toBeVisible();

    // Pre-order should appear in the list (check for partner name)
    await expect(page.getByText(partnerName!)).toBeVisible({ timeout: 5000 });

    // Step 5: Add a flow to this pre-order (still offline)
    // Use data-testid with order ID prefix to find the add flow form elements
    const productSelect = page.getByTestId(
      `add-flow-product-select-${orderIdSuffix}`,
    );
    await productSelect.click();
    await expect(page.locator('[role="option"]').first()).toBeVisible({
      timeout: 5000,
    });
    await page.locator('[role="option"]').first().click();

    // Fill quantity
    await page
      .getByTestId(`add-flow-quantity-input-${orderIdSuffix}`)
      .fill("10");

    // Select unit
    const unitSelect = page.getByTestId(
      `add-flow-unit-select-${orderIdSuffix}`,
    );
    await unitSelect.click();
    await expect(page.locator('[role="option"]').first()).toBeVisible({
      timeout: 5000,
    });
    await page.locator('[role="option"]').first().click();

    // Fill price
    await page
      .getByTestId(`add-flow-price-input-${orderIdSuffix}`)
      .fill("25.50");

    // Click Add button
    await page.getByTestId(`add-flow-button-${orderIdSuffix}`).click();

    // Verify flow operation is in outbox
    await page.waitForTimeout(500);
    const outboxOpsAfterFlow = await dbHelpers.getOutboxOperations(page);
    const flowOp = outboxOpsAfterFlow.find(
      (op) =>
        op.operation_type === "CREATE" && op.entity_type === "pre_order_flow",
    );

    expect(flowOp).toBeDefined();
    expect(flowOp?.status).toBe("pending");

    // Step 6: Set network to online
    await networkSimulator.setOnline(page);

    // Step 7: Wait for automatic synchronization
    await dbHelpers.waitForSyncToComplete(page, 3000);

    // Step 8: Verify outbox is empty (all operations synced)
    const finalOutboxOps = await dbHelpers.getOutboxOperations(page);
    const pendingOps = finalOutboxOps.filter(
      (op) => op.status === "pending" || op.status === "syncing",
    );
    expect(pendingOps.length).toBe(0);

    // Step 9: Verify data is persisted
    // Get the pre-order ID from IndexedDB
    const preOrders = await dbHelpers.getPreOrders(page);
    const createdOrder = preOrders.find(
      (order) => order.id === createOp!.entity_id,
    );
    expect(createdOrder).toBeDefined();

    // Verify via API request
    const response = await page.request.get(
      `${E2E_API_URL}/pre-orders/recap/${today}`,
    );
    expect(response.ok()).toBe(true);
    const recapData = await response.json();

    // Find the order in recap data
    const orderInRecap = recapData
      .flatMap((group: any) => group.pre_orders || [])
      .find((order: any) => order.id === createdOrder!.id);

    expect(orderInRecap).toBeDefined();
    expect(orderInRecap.partner_id).toBe(createdOrder!.partner_id);

    expect(orderInRecap.flows).toBeDefined();
    expect(orderInRecap.flows.length).toBeGreaterThan(0);
  });

  test("should delete order offline and sync when online", async ({ page }) => {
    // Step 1: Wait for orders to load
    const deleteButton = page.getByTestId("order-delete-button").first();
    await expect(deleteButton).toBeVisible({ timeout: 1000 });

    // Get order ID from the card containing the delete button
    const orderId = await deleteButton
      .locator("xpath=ancestor::*[@data-order-id]")
      .getAttribute("data-order-id");

    // Get initial order count
    const today = new Date().toISOString().split("T")[0];
    const initialResponse = await page.request.get(
      `${E2E_API_URL}/pre-orders/recap/${today}`,
    );
    const initialRecapData = await initialResponse.json();
    const allInitialOrders = initialRecapData.flatMap(
      (group: any) => group.pre_orders || [],
    );
    const initialOrder = allInitialOrders.find(
      (order: any) => order.id === orderId,
    );
    expect(initialOrder).toBeDefined();

    // Step 2: Set network to offline
    await networkSimulator.setOffline(page);

    // Step 3: Delete the order
    // Set up dialog handler before clicking
    page.once("dialog", (dialog) => {
      dialog.accept();
    });

    await deleteButton.click();

    // Step 4: Verify DELETE operation in outbox
    await page.waitForTimeout(1000);
    const outboxOps = await dbHelpers.getOutboxOperations(page);
    const deleteOp = outboxOps.find(
      (op) => op.operation_type === "DELETE" && op.entity_type === "pre_order",
    );
    expect(deleteOp).toBeDefined();
    expect(deleteOp?.status).toBe("pending");

    // Step 5: Set network to online
    await networkSimulator.setOnline(page);

    // Step 6: Wait for synchronization
    await dbHelpers.waitForSyncToComplete(page, 3000);

    // Step 7: Verify order is deleted on server
    const response = await page.request.get(
      `${E2E_API_URL}/pre-orders/recap/${today}`,
    );
    expect(response.ok()).toBe(true);
    const recapData = await response.json();

    // Verify order is deleted from server
    const allFinalOrders = recapData.flatMap(
      (group: any) => group.pre_orders || [],
    );
    const deletedOrder = allFinalOrders.find(
      (order: any) => order.id === orderId,
    );
    expect(deletedOrder).toBeUndefined();
  });

  test("should batch sync multiple operations offline", async ({ page }) => {
    // Step 1: Set network to offline
    await networkSimulator.setOffline(page);

    // Step 2: Create a pre-order
    await page.getByTestId("add-order-button").click();
    await expect(page.getByTestId("add-order-dialog")).toBeVisible();

    const partnerSelect = page.getByTestId("add-order-partner-select");
    await partnerSelect.click();
    await expect(page.locator('[role="option"]').first()).toBeVisible({
      timeout: 5000,
    });
    await page.locator('[role="option"]').first().click();

    const today = new Date().toISOString().split("T")[0];
    await page.getByTestId("add-order-delivery-date").fill(today);

    await page.getByTestId("add-order-create-button").click();
    await page.waitForTimeout(1000);

    // Get order ID from outbox
    const createOutboxOps = await dbHelpers.getOutboxOperations(page);
    const createOp = createOutboxOps.find(
      (op) => op.operation_type === "CREATE" && op.entity_type === "pre_order",
    );
    expect(createOp).toBeDefined();
    const orderIdSuffix = createOp!.entity_id.slice(-8);

    // Step 3: Update status (if order is visible)
    const statusBadge = page
      .getByTestId(`order-status-badge-${orderIdSuffix}`)
      .first();

    await statusBadge.click();
    await page.waitForTimeout(1000);

    // Step 4: Verify all operations are in outbox
    const outboxOps = await dbHelpers.getOutboxOperations(page);
    const pendingOps = outboxOps.filter((op) => op.status === "pending");
    expect(pendingOps.length).toBeGreaterThanOrEqual(2);

    // Step 5: Set network to online
    await networkSimulator.setOnline(page);

    // Step 6: Wait for synchronization
    await dbHelpers.waitForSyncToComplete(page, 3000);

    // All operations should be synced
    const finalOutboxOps = await dbHelpers.getOutboxOperations(page);
    const stillPending = finalOutboxOps.filter(
      (op) => op.status === "pending" || op.status === "syncing",
    );
    expect(stillPending.length).toBe(0);

    // Step 7: Verify status was updated
    const response = await page.request.get(
      `${E2E_API_URL}/pre-orders/recap/${today}`,
    );
    expect(response.ok()).toBe(true);
    const recapData = await response.json();

    // Verify status was updated
    const allOrders = recapData.flatMap((group: any) => group.pre_orders || []);

    const updatedOrder = allOrders.find(
      (order: any) => order.id === createOp?.entity_id,
    );
    expect(updatedOrder).toBeDefined();
    expect(updatedOrder?.status).toBe(1);
  });
});
