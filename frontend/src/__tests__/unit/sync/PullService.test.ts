import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockSyncDB,
  createMockOperation,
  createMockPullOperation,
  createMockSnapshotData,
} from "../../mocks/syncdb.mock";
import "../../mocks/queryInvalidator.mock";
import { mockApi } from "../../mocks/api.mock";
import { mockLogger } from "../../mocks/logger.mock";
import { PullService } from "@/lib/sync/PullService";
import { queryInvalidator } from "@/lib/sync/QueryInvalidator";

describe("PullService", () => {
  let pullService: PullService;
  let mockDB: ReturnType<typeof createMockSyncDB>;

  beforeEach(() => {
    mockDB = createMockSyncDB();
    pullService = new PullService(mockDB);

    // Clear mocks
    vi.mocked(mockApi.getSnapshot).mockClear();
    vi.mocked(mockApi.pullOperations).mockClear();
    vi.mocked(mockLogger.info).mockClear();
    vi.mocked(mockLogger.warn).mockClear();
    vi.mocked(mockLogger.error).mockClear();
    vi.mocked(queryInvalidator.invalidatePreOrdersByIds).mockClear();
    vi.mocked(queryInvalidator.invalidateAll).mockClear();
  });

  describe("start()", () => {
    it("should fetch initial snapshot when DB is empty", async () => {
      vi.mocked(mockDB.metadata.get).mockResolvedValue(undefined);
      vi.mocked(mockApi.getSnapshot).mockResolvedValue(
        createMockSnapshotData({
          partners: [{ id: "p1", name: "Partner 1", code: null, type: 1 }],
        }),
      );

      await pullService.start();

      expect(mockApi.getSnapshot).toHaveBeenCalled();
      expect(mockDB.partners.bulkPut).toHaveBeenCalled();
    });

    it("should skip initial snapshot when DB has data", async () => {
      vi.mocked(mockDB.metadata.get).mockResolvedValue({
        key: "last_sync_timestamp",
        value: Date.now(),
      });

      await pullService.start();

      expect(mockApi.getSnapshot).not.toHaveBeenCalled();
    });

    it("should propagate errors during start", async () => {
      vi.mocked(mockDB.metadata.get).mockRejectedValue(new Error("DB error"));

      await expect(pullService.start()).rejects.toThrow("DB error");
    });
  });

  describe("syncInitialSnapshot()", () => {
    it("should prevent concurrent snapshot syncs", async () => {
      vi.mocked(mockApi.getSnapshot).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(createMockSnapshotData()), 100),
          ),
      );

      const promise1 = pullService.syncInitialSnapshot();
      const promise2 = pullService.syncInitialSnapshot();

      await promise1;
      await promise2;

      // API should only be called once
      expect(mockApi.getSnapshot).toHaveBeenCalledTimes(1);
    });

    it("should populate all database tables", async () => {
      const snapshotData = createMockSnapshotData({
        partners: [{ id: "p1", name: "Partner 1", code: null, type: 1 }],
        products: [
          {
            id: "prod1",
            name: "Product 1",
            code: null,
            short_name: null,
            sku: null,
          },
        ],
        units: [{ id: "u1", name: "Unit 1", abbreviation: "u1" }],
        pre_orders: [
          {
            id: "po1",
            partner_id: "p1",
            status: 0,
            order_date: null,
            delivery_date: "2024-01-15",
            comment: null,
            created_at: null,
            updated_at: null,
          },
        ],
        flows: [
          {
            id: "f1",
            pre_order_id: "po1",
            product_id: "prod1",
            unit_id: "u1",
            quantity: 10,
            price: 100,
            comment: null,
            created_at: null,
            updated_at: null,
          },
        ],
      });

      vi.mocked(mockApi.getSnapshot).mockResolvedValue(snapshotData);

      await pullService.syncInitialSnapshot();

      expect(mockDB.partners.bulkPut).toHaveBeenCalledWith(
        snapshotData.partners,
      );
      expect(mockDB.products.bulkPut).toHaveBeenCalledWith(
        snapshotData.products,
      );
      expect(mockDB.units.bulkPut).toHaveBeenCalledWith(snapshotData.units);
      expect(mockDB.pre_orders.bulkPut).toHaveBeenCalled();
      expect(mockDB.pre_order_flows.bulkPut).toHaveBeenCalled();
    });

    it("should invalidate all cache after snapshot", async () => {
      vi.mocked(mockApi.getSnapshot).mockResolvedValue(
        createMockSnapshotData(),
      );

      await pullService.syncInitialSnapshot();

      expect(queryInvalidator.invalidateAll).toHaveBeenCalled();
    });

    it("should update last_sync_timestamp", async () => {
      vi.mocked(mockApi.getSnapshot).mockResolvedValue(
        createMockSnapshotData(),
      );

      await pullService.syncInitialSnapshot();

      expect(mockDB.metadata.put).toHaveBeenCalledWith({
        key: "last_sync_timestamp",
        value: expect.any(Number),
      });
    });

    it("should handle snapshot fetch errors", async () => {
      vi.mocked(mockApi.getSnapshot).mockRejectedValue(
        new Error("Network error"),
      );

      await expect(pullService.syncInitialSnapshot()).rejects.toThrow(
        "Network error",
      );

      // Should reset syncing flag
      expect(pullService.getStatus().syncing).toBe(false);
    });

    it("should handle empty snapshot gracefully", async () => {
      vi.mocked(mockApi.getSnapshot).mockResolvedValue({
        partners: [],
        products: [],
        units: [],
        pre_orders: [],
        flows: [],
      });

      await pullService.syncInitialSnapshot();

      // Should not call bulkPut for empty arrays
      expect(mockDB.partners.bulkPut).not.toHaveBeenCalled();
    });
  });

  describe("pullIncremental()", () => {
    it("should pull and apply operations without conflicts", async () => {
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(0);
      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([]);

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [
          createMockPullOperation({
            sync_id: 1,
            entity_type: "pre_order",
            entity_id: "po1",
            operation_type: "CREATE",
            data: { partner_id: "p1", delivery_date: "2024-01-15" },
          }),
        ],
        has_more: false,
      });

      await pullService.pullIncremental();

      expect(mockDB.pre_orders.put).toHaveBeenCalled();
      expect(mockDB.setLastSyncId).toHaveBeenCalledWith(1);
    });

    it("should handle pagination with has_more", async () => {
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(0);
      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([]);

      // First page
      vi.mocked(mockApi.pullOperations)
        .mockResolvedValueOnce({
          operations: [createMockPullOperation({ sync_id: 1 })],
          has_more: true,
        })
        // Second page
        .mockResolvedValueOnce({
          operations: [createMockPullOperation({ sync_id: 2 })],
          has_more: false,
        });

      await pullService.pullIncremental();

      expect(mockApi.pullOperations).toHaveBeenCalledTimes(2);
      expect(mockApi.pullOperations).toHaveBeenNthCalledWith(1, 0, 100);
      expect(mockApi.pullOperations).toHaveBeenNthCalledWith(2, 1, 100);
      expect(mockDB.setLastSyncId).toHaveBeenCalledWith(2);
    });

    it("should stop pagination when operations array is empty", async () => {
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(5);
      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([]);

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [],
        has_more: true, // Even if has_more is true
      });

      await pullService.pullIncremental();

      expect(mockApi.pullOperations).toHaveBeenCalledTimes(1);
      expect(mockDB.setLastSyncId).not.toHaveBeenCalled();
    });

    it("should prevent concurrent pulls", async () => {
      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([]);
      vi.mocked(mockApi.pullOperations).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  operations: [],
                  has_more: false,
                }),
              100,
            ),
          ),
      );

      const promise1 = pullService.pullIncremental();
      const promise2 = pullService.pullIncremental();

      await promise1;
      await promise2;

      // API should only be called once
      expect(mockApi.pullOperations).toHaveBeenCalledTimes(1);
    });

    it("should rebase entity when local operations exist", async () => {
      const localOp = createMockOperation({
        id: "local-1",
        entity_type: "pre_order",
        entity_id: "po1",
        operation_type: "UPDATE",
        data: { status: 1 },
      });

      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([localOp]);
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(0);
      vi.mocked(mockDB.pre_orders.get).mockResolvedValue({
        id: "po1",
        partner_id: "p1",
        status: 0,
        order_date: null,
        delivery_date: "2024-01-15",
        comment: null,
        created_at: null,
        updated_at: null,
        version: 2,
      });

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [
          createMockPullOperation({
            sync_id: 1,
            entity_type: "pre_order",
            entity_id: "po1",
            operation_type: "UPDATE",
            data: { comment: "Server update", version: 2 },
          }),
        ],
        has_more: false,
      });

      await pullService.pullIncremental();

      // Should apply server operation first
      expect(mockDB.pre_orders.update).toHaveBeenCalledWith(
        "po1",
        expect.objectContaining({ comment: "Server update" }),
      );

      // Should reapply local operation
      expect(mockDB.pre_orders.update).toHaveBeenCalledWith(
        "po1",
        expect.objectContaining({ status: 1 }),
      );
    });

    it("should handle server DELETE during rebase", async () => {
      const localOp = createMockOperation({
        entity_type: "pre_order",
        entity_id: "po1",
        operation_type: "UPDATE",
      });

      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([localOp]);
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(0);
      vi.mocked(mockDB.pre_orders.get).mockResolvedValue(null);

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [
          createMockPullOperation({
            sync_id: 1,
            entity_type: "pre_order",
            entity_id: "po1",
            operation_type: "DELETE",
            data: {},
          }),
        ],
        has_more: false,
      });

      await pullService.pullIncremental();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("deleted by server"),
      );
    });

    it("should group pending operations by entity correctly", async () => {
      const ops = [
        createMockOperation({ entity_type: "pre_order", entity_id: "po1" }),
        createMockOperation({ entity_type: "pre_order", entity_id: "po1" }),
        createMockOperation({ entity_type: "pre_order", entity_id: "po2" }),
      ];

      vi.mocked(mockDB.getPendingOperations).mockResolvedValue(ops);
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(0);
      vi.mocked(mockDB.pre_orders.get).mockResolvedValue({
        id: "po1",
        partner_id: "p1",
        status: 0,
        order_date: null,
        delivery_date: "2024-01-15",
        comment: null,
        created_at: null,
        updated_at: null,
        version: 1,
      });

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [
          createMockPullOperation({
            entity_type: "pre_order",
            entity_id: "po1",
            operation_type: "UPDATE",
            data: { status: 1 },
          }),
        ],
        has_more: false,
      });

      await pullService.pullIncremental();

      // Should detect 2 local ops for po1 and trigger rebase
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Rebasing 2 local operations"),
      );
    });

    it("should reapply local DELETE operation", async () => {
      const localDeleteOp = createMockOperation({
        entity_type: "pre_order",
        entity_id: "po1",
        operation_type: "DELETE",
      });

      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([localDeleteOp]);
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(0);
      vi.mocked(mockDB.pre_orders.get).mockResolvedValue({
        id: "po1",
        partner_id: "p1",
        status: 0,
        order_date: null,
        delivery_date: "2024-01-15",
        comment: null,
        created_at: null,
        updated_at: null,
        version: 2,
      });

      const mockWhere = {
        equals: vi.fn(() => ({
          toArray: vi.fn(() =>
            Promise.resolve([
              { id: "flow1", pre_order_id: "po1" },
              { id: "flow2", pre_order_id: "po1" },
            ]),
          ),
        })),
      };
      vi.mocked(mockDB.pre_order_flows.where).mockReturnValue(mockWhere as any);

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [
          createMockPullOperation({
            entity_type: "pre_order",
            entity_id: "po1",
            operation_type: "UPDATE",
            data: { status: 1, version: 2 },
          }),
        ],
        has_more: false,
      });

      await pullService.pullIncremental();

      // Should apply server update first, then reapply local DELETE (soft delete via update)
      expect(mockDB.pre_orders.update).toHaveBeenCalledWith(
        "po1",
        expect.objectContaining({
          deleted_at: expect.any(String),
          version: 3,
          updated_at: expect.any(String),
        }),
      );

      // Should also soft-delete associated flows
      expect(mockDB.pre_order_flows.update).toHaveBeenCalledTimes(2);
      expect(mockDB.pre_order_flows.update).toHaveBeenCalledWith(
        "flow1",
        expect.objectContaining({
          deleted_at: expect.any(String),
          updated_at: expect.any(String),
        }),
      );
      expect(mockDB.pre_order_flows.update).toHaveBeenCalledWith(
        "flow2",
        expect.objectContaining({
          deleted_at: expect.any(String),
          updated_at: expect.any(String),
        }),
      );
    });

    it("should invalidate cache for affected pre_orders", async () => {
      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([]);
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(0);

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [
          createMockPullOperation({
            entity_type: "pre_order",
            entity_id: "po1",
            operation_type: "UPDATE",
            data: { status: 1 },
          }),
          createMockPullOperation({
            entity_type: "pre_order",
            entity_id: "po2",
            operation_type: "CREATE",
            data: { partner_id: "p1", delivery_date: "2024-01-15" },
          }),
        ],
        has_more: false,
      });

      await pullService.pullIncremental();

      expect(queryInvalidator.invalidatePreOrdersByIds).toHaveBeenCalledWith(
        expect.arrayContaining(["po1", "po2"]),
      );
    });

    it("should invalidate cache for flows by extracting pre_order_id", async () => {
      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([]);
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(0);

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [
          createMockPullOperation({
            entity_type: "pre_order_flow",
            entity_id: "flow1",
            operation_type: "CREATE",
            data: { pre_order_id: "po-123", product_id: "prod1" },
          }),
        ],
        has_more: false,
      });

      await pullService.pullIncremental();

      expect(queryInvalidator.invalidatePreOrdersByIds).toHaveBeenCalledWith([
        "po-123",
      ]);
    });

    it("should fetch pre_order_id from DB when not in operation data", async () => {
      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([]);
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(0);
      vi.mocked(mockDB.pre_order_flows.get)
        .mockResolvedValueOnce({
          id: "flow1",
          pre_order_id: "po-456",
          product_id: "prod1",
          unit_id: "unit1",
          quantity: 10,
          price: 100,
          comment: null,
          created_at: null,
          updated_at: null,
          version: 1,
        })
        .mockResolvedValueOnce({
          id: "flow1",
          pre_order_id: "po-456",
          product_id: "prod1",
          unit_id: "unit1",
          quantity: 10,
          price: 100,
          comment: null,
          created_at: null,
          updated_at: null,
          version: 2,
        });

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [
          createMockPullOperation({
            entity_type: "pre_order_flow",
            entity_id: "flow1",
            operation_type: "UPDATE",
            data: { quantity: 10 },
          }),
        ],
        has_more: false,
      });

      await pullService.pullIncremental();

      expect(mockDB.pre_order_flows.get).toHaveBeenCalledWith("flow1");
      expect(queryInvalidator.invalidatePreOrdersByIds).toHaveBeenCalledWith([
        "po-456",
      ]);
    });

    it("should handle pull operation errors", async () => {
      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([]);
      vi.mocked(mockApi.pullOperations).mockRejectedValue(
        new Error("Network error"),
      );

      await expect(pullService.pullIncremental()).rejects.toThrow(
        "Network error",
      );

      // Should reset syncing flag
      expect(pullService.getStatus().syncing).toBe(false);
    });

    it("should handle errors during operation application", async () => {
      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([]);
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(0);
      vi.mocked(mockDB.pre_orders.put).mockRejectedValue(new Error("DB error"));

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [
          createMockPullOperation({
            entity_type: "pre_order",
            operation_type: "CREATE",
            data: { partner_id: "p1", delivery_date: "2024-01-15" },
          }),
        ],
        has_more: false,
      });

      await expect(pullService.pullIncremental()).rejects.toThrow("DB error");
    });

    it("should not invalidate cache when no operations", async () => {
      vi.mocked(mockDB.getPendingOperations).mockResolvedValue([]);
      vi.mocked(mockDB.getLastSyncId).mockResolvedValue(5);

      vi.mocked(mockApi.pullOperations).mockResolvedValue({
        operations: [],
        has_more: false,
      });

      await pullService.pullIncremental();

      expect(queryInvalidator.invalidatePreOrdersByIds).not.toHaveBeenCalled();
    });
  });

  describe("Operation handling", () => {
    it("should apply PreOrder CREATE operation", async () => {
      const operation = createMockPullOperation({
        entity_type: "pre_order",
        entity_id: "po1",
        operation_type: "CREATE",
        data: {
          partner_id: "p1",
          status: 0,
          delivery_date: "2024-01-15",
          comment: "Test order",
          version: 1,
        },
      });

      await (pullService as any).applyOperation(operation);

      expect(mockDB.pre_orders.put).toHaveBeenCalledWith({
        id: "po1",
        partner_id: "p1",
        status: 0,
        order_date: null,
        delivery_date: "2024-01-15",
        comment: "Test order",
        created_at: null,
        updated_at: null,
        version: 1,
        deleted_at: null,
      });
    });

    it("should apply PreOrder UPDATE operation", async () => {
      vi.mocked(mockDB.pre_orders.get).mockResolvedValue({
        id: "po1",
        partner_id: "p1",
        status: 0,
        order_date: null,
        delivery_date: "2024-01-15",
        comment: null,
        created_at: null,
        updated_at: null,
        version: 1,
      });

      const operation = createMockPullOperation({
        entity_type: "pre_order",
        entity_id: "po1",
        operation_type: "UPDATE",
        data: {
          status: 1,
          comment: "Updated",
          version: 2,
        },
      });

      await (pullService as any).applyOperation(operation);

      expect(mockDB.pre_orders.update).toHaveBeenCalledWith("po1", {
        status: 1,
        comment: "Updated",
        version: 2,
      });
    });

    it("should apply PreOrder DELETE and cascade to flows", async () => {
      const flows = [
        { id: "flow1", pre_order_id: "po1", version: 1 },
        { id: "flow2", pre_order_id: "po1", version: 1 },
      ];

      vi.mocked(mockDB.pre_orders.get).mockResolvedValue({
        id: "po1",
        partner_id: "p1",
        status: 0,
        order_date: null,
        delivery_date: "2024-01-15",
        comment: null,
        created_at: null,
        updated_at: null,
        version: 1,
      });

      const mockWhere = {
        equals: vi.fn(() => ({
          toArray: vi.fn(() => Promise.resolve(flows)),
        })),
      };
      vi.mocked(mockDB.pre_order_flows.where).mockReturnValue(mockWhere as any);

      const operation = createMockPullOperation({
        entity_type: "pre_order",
        entity_id: "po1",
        operation_type: "DELETE",
        data: {},
      });

      await (pullService as any).applyOperation(operation);

      // Soft delete: update with deleted_at
      expect(mockDB.pre_orders.update).toHaveBeenCalledWith(
        "po1",
        expect.objectContaining({
          deleted_at: expect.any(String),
          version: 2,
          updated_at: expect.any(String),
        }),
      );
      expect(mockDB.pre_order_flows.update).toHaveBeenCalledWith(
        "flow1",
        expect.objectContaining({
          deleted_at: expect.any(String),
          version: 2,
          updated_at: expect.any(String),
        }),
      );
      expect(mockDB.pre_order_flows.update).toHaveBeenCalledWith(
        "flow2",
        expect.objectContaining({
          deleted_at: expect.any(String),
          version: 2,
          updated_at: expect.any(String),
        }),
      );
    });

    it("should apply PreOrderFlow CREATE operation", async () => {
      const operation = createMockPullOperation({
        entity_type: "pre_order_flow",
        entity_id: "flow1",
        operation_type: "CREATE",
        data: {
          pre_order_id: "po1",
          product_id: "prod1",
          unit_id: "unit1",
          quantity: 10,
          price: 100,
          comment: "Test flow",
          version: 1,
        },
      });

      await (pullService as any).applyOperation(operation);

      expect(mockDB.pre_order_flows.put).toHaveBeenCalledWith({
        id: "flow1",
        pre_order_id: "po1",
        product_id: "prod1",
        unit_id: "unit1",
        quantity: 10,
        price: 100,
        comment: "Test flow",
        created_at: null,
        updated_at: null,
        version: 1,
        deleted_at: null,
      });
    });

    it("should apply PreOrderFlow UPDATE operation", async () => {
      vi.mocked(mockDB.pre_order_flows.get).mockResolvedValue({
        id: "flow1",
        pre_order_id: "po1",
        product_id: "prod1",
        unit_id: "unit1",
        quantity: 10,
        price: 100,
        comment: null,
        created_at: null,
        updated_at: null,
        version: 1,
      });

      const operation = createMockPullOperation({
        entity_type: "pre_order_flow",
        entity_id: "flow1",
        operation_type: "UPDATE",
        data: {
          quantity: 15,
          price: 150,
          version: 2,
        },
      });

      await (pullService as any).applyOperation(operation);

      expect(mockDB.pre_order_flows.update).toHaveBeenCalledWith("flow1", {
        quantity: 15,
        price: 150,
        version: 2,
      });
    });

    it("should apply PreOrderFlow DELETE operation", async () => {
      vi.mocked(mockDB.pre_order_flows.get).mockResolvedValue({
        id: "flow1",
        pre_order_id: "po1",
        product_id: "prod1",
        unit_id: "unit1",
        quantity: 10,
        price: 100,
        comment: null,
        created_at: null,
        updated_at: null,
        version: 1,
      });

      const operation = createMockPullOperation({
        entity_type: "pre_order_flow",
        entity_id: "flow1",
        operation_type: "DELETE",
        data: {},
      });

      await (pullService as any).applyOperation(operation);

      // Soft delete: update with deleted_at
      expect(mockDB.pre_order_flows.update).toHaveBeenCalledWith(
        "flow1",
        expect.objectContaining({
          deleted_at: expect.any(String),
          version: 2,
          updated_at: expect.any(String),
        }),
      );
    });

    it("should skip UPDATE when entity doesn't exist", async () => {
      vi.mocked(mockDB.pre_orders.get).mockResolvedValue(null);

      const operation = createMockPullOperation({
        entity_type: "pre_order",
        entity_id: "po1",
        operation_type: "UPDATE",
        data: { status: 1 },
      });

      await (pullService as any).applyOperation(operation);

      expect(mockDB.pre_orders.update).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("not found for UPDATE"),
      );
    });

    it("should extract only updateable fields from data", () => {
      const data = {
        partner_id: "p1",
        status: 1,
        comment: "Test",
        version: 2,
        id: "po1",
        some_other: "field",
      };

      const result = (pullService as any).pickFields(data, [
        "partner_id",
        "status",
        "comment",
      ]);

      expect(result).toEqual({
        partner_id: "p1",
        status: 1,
        comment: "Test",
      });
    });

    it("should not include undefined fields", () => {
      const data = {
        status: 1,
        comment: undefined,
      };

      const result = (pullService as any).pickFields(data, [
        "status",
        "comment",
      ]);

      expect(result).toEqual({ status: 1 });
      expect(result).not.toHaveProperty("comment");
    });

    it("should not update version when reapplying local operations", async () => {
      const localOpData = { status: 1, version: 3 };

      vi.mocked(mockDB.pre_orders.get).mockResolvedValue({
        id: "po1",
        partner_id: "p1",
        status: 0,
        order_date: null,
        delivery_date: "2024-01-15",
        comment: null,
        created_at: null,
        updated_at: null,
        version: 5,
      });

      await (pullService as any).reapplyLocalUpdate(
        "pre_order",
        "po1",
        localOpData,
      );

      // Should update status but NOT version
      expect(mockDB.pre_orders.update).toHaveBeenCalledWith("po1", {
        status: 1,
      });
    });
  });
});
