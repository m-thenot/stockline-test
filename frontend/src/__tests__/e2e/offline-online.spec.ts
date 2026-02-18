import { test, expect } from "@playwright/test";
import { NetworkSimulator } from "./helpers/NetworkSimulator";
import { DatabaseHelpers } from "./helpers/DatabaseHelpers";
import { RecapPage } from "./pages/RecapPage";
import { E2E_API_URL } from "./config";

test.describe("Offline → Online Workflow", () => {
  let networkSimulator: NetworkSimulator;
  let dbHelpers: DatabaseHelpers;
  let recapPage: RecapPage;

  test.beforeEach(async ({ page }) => {
    networkSimulator = new NetworkSimulator();
    dbHelpers = new DatabaseHelpers();
    recapPage = new RecapPage(page);

    await recapPage.navigate();
    await page.waitForTimeout(2000);
  });

  test.afterEach(async ({ page }) => {
    // Reset network state
    await networkSimulator.reset(page);
  });

  test("should create order offline and sync when online", async ({ page }) => {
    await networkSimulator.setOffline(page);

    const { partnerName } = await recapPage.createOrder();

    await page.waitForTimeout(500);
    const outboxOps = await dbHelpers.getOutboxOperations(page);
    const createOp = outboxOps.find(
      (op) => op.operation_type === "CREATE" && op.entity_type === "pre_order",
    );
    expect(createOp).toBeDefined();
    expect(createOp?.status).toBe("pending");

    const orderIdSuffix = createOp!.entity_id.slice(-8);

    await expect(page.getByTestId("add-order-dialog")).not.toBeVisible();
    await expect(page.getByText(partnerName)).toBeVisible({ timeout: 5000 });

    await recapPage.addFlowToOrder(orderIdSuffix, {
      quantity: "10",
      price: "25.50",
    });

    // Verify flow operation is in outbox
    await page.waitForTimeout(500);
    const outboxOpsAfterFlow = await dbHelpers.getOutboxOperations(page);
    const flowOp = outboxOpsAfterFlow.find(
      (op) =>
        op.operation_type === "CREATE" && op.entity_type === "pre_order_flow",
    );

    expect(flowOp).toBeDefined();
    expect(flowOp?.status).toBe("pending");

    await networkSimulator.setOnline(page);
    await dbHelpers.waitForSyncToComplete(page, 3000);

    const today = new Date().toISOString().split("T")[0];
    const finalOutboxOps = await dbHelpers.getOutboxOperations(page);
    const pendingOps = finalOutboxOps.filter(
      (op) => op.status === "pending" || op.status === "syncing",
    );
    expect(pendingOps.length).toBe(0);

    // Verify data is persisted (IndexedDB + API)
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
    await expect(page.getByTestId("order-delete-button").first()).toBeVisible({
      timeout: 1000,
    });

    const orderId = await recapPage.getFirstOrderId();
    expect(orderId).toBeTruthy();

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

    await networkSimulator.setOffline(page);

    page.once("dialog", (dialog) => {
      dialog.accept();
    });
    await recapPage.deleteFirstOrder();

    // Verify DELETE operation in outbox
    await page.waitForTimeout(1000);
    const outboxOps = await dbHelpers.getOutboxOperations(page);
    const deleteOp = outboxOps.find(
      (op) => op.operation_type === "DELETE" && op.entity_type === "pre_order",
    );
    expect(deleteOp).toBeDefined();
    expect(deleteOp?.status).toBe("pending");

    await networkSimulator.setOnline(page);
    await dbHelpers.waitForSyncToComplete(page, 3000);

    // Verify order is deleted on server
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
    await networkSimulator.setOffline(page);

    await recapPage.createOrder();
    await page.waitForTimeout(1000);

    const createOutboxOps = await dbHelpers.getOutboxOperations(page);
    const createOp = createOutboxOps.find(
      (op) => op.operation_type === "CREATE" && op.entity_type === "pre_order",
    );
    expect(createOp).toBeDefined();
    const orderIdSuffix = createOp!.entity_id.slice(-8);

    await recapPage.clickStatusBadge(orderIdSuffix);
    await page.waitForTimeout(1000);

    // Verify all operations are in outbox
    const outboxOps = await dbHelpers.getOutboxOperations(page);
    const pendingOps = outboxOps.filter((op) => op.status === "pending");
    expect(pendingOps.length).toBeGreaterThanOrEqual(2);

    await networkSimulator.setOnline(page);
    await dbHelpers.waitForSyncToComplete(page, 3000);

    const finalOutboxOps = await dbHelpers.getOutboxOperations(page);
    const stillPending = finalOutboxOps.filter(
      (op) => op.status === "pending" || op.status === "syncing",
    );
    expect(stillPending.length).toBe(0);

    const today = new Date().toISOString().split("T")[0];
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
