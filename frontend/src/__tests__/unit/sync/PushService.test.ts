import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PushOperationResult } from "@/lib/sync/types";
import { OutboxOperation } from "@/lib/db/models";
import { createMockSyncDB, createMockOperation } from "../../mocks/syncdb.mock";
import { mockApi } from "../../mocks/api.mock";
import { mockLogger } from "../../mocks/logger.mock";
import "../../mocks/queryInvalidator.mock";

import { PushService } from "@/lib/sync/PushService";
import { queryInvalidator } from "@/lib/sync/QueryInvalidator";

describe("PushService.coalesceOperations()", () => {
  let pushService: PushService;
  let mockDB: ReturnType<typeof createMockSyncDB>;

  beforeEach(() => {
    mockDB = createMockSyncDB();
    pushService = new PushService(mockDB);
  });

  describe("Single operations (no coalescing)", () => {
    it("should pass through a single CREATE operation unchanged", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          sequence_number: 1,
          entity_id: "entity-123",
          operation_type: "CREATE",
          data: { name: "Test Order", status: 0 },
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0]).toEqual(operations[0]);
      expect(result.toRemoveIds).toHaveLength(0);
    });

    it("should pass through a single UPDATE operation unchanged", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          sequence_number: 1,
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { name: "Updated Order", version: 1 },
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0]).toEqual(operations[0]);
      expect(result.toRemoveIds).toHaveLength(0);
    });

    it("should pass through a single DELETE operation unchanged", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          sequence_number: 1,
          entity_id: "entity-123",
          operation_type: "DELETE",
          data: {},
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0]).toEqual(operations[0]);
      expect(result.toRemoveIds).toHaveLength(0);
    });
  });

  describe("CREATE + UPDATE coalescing", () => {
    it("should merge CREATE + 1 UPDATE into single CREATE", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          sequence_number: 1,
          entity_id: "entity-123",
          operation_type: "CREATE",
          data: { name: "Test Order", status: 0, version: 1 },
          timestamp: "2024-01-01T10:00:00Z",
        }),
        createMockOperation({
          id: "op-2",
          sequence_number: 2,
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1, version: 2 },
          timestamp: "2024-01-01T10:05:00Z",
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0]).toMatchObject({
        id: "op-1",
        sequence_number: 1,
        entity_id: "entity-123",
        operation_type: "CREATE",
        data: { name: "Test Order", status: 1, version: 1 }, // Merged data, CREATE version kept
        timestamp: "2024-01-01T10:05:00Z", // Last timestamp
      });
      expect(result.toRemoveIds).toEqual(["op-2"]);
    });

    it("should merge CREATE + multiple UPDATEs into single CREATE", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          sequence_number: 1,
          entity_id: "entity-123",
          operation_type: "CREATE",
          data: { name: "Test Order", status: 0, version: 1 },
          timestamp: "2024-01-01T10:00:00Z",
        }),
        createMockOperation({
          id: "op-2",
          sequence_number: 2,
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1, version: 2 },
          timestamp: "2024-01-01T10:05:00Z",
        }),
        createMockOperation({
          id: "op-3",
          sequence_number: 3,
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { comment: "Updated comment", version: 3 },
          timestamp: "2024-01-01T10:10:00Z",
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0]).toMatchObject({
        id: "op-1",
        sequence_number: 1,
        entity_id: "entity-123",
        operation_type: "CREATE",
        data: {
          name: "Test Order",
          status: 1,
          comment: "Updated comment",
          version: 1,
        },
        timestamp: "2024-01-01T10:10:00Z",
      });
      expect(result.toRemoveIds).toEqual(["op-2", "op-3"]);
    });

    it("should use last UPDATE timestamp in merged CREATE", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "CREATE",
          timestamp: "2024-01-01T10:00:00Z",
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          timestamp: "2024-01-01T10:05:00Z",
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend[0].timestamp).toBe("2024-01-01T10:05:00Z");
    });

    it("should merge partial UPDATE data correctly", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "CREATE",
          data: { name: "Test Order", status: 0, comment: null },
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { comment: "New comment" }, // Partial update
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend[0].data).toEqual({
        name: "Test Order",
        status: 0,
        comment: "New comment",
      });
    });

    it("should strip version field from UPDATEs when merging to CREATE", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "CREATE",
          data: { name: "Test Order", version: 1 },
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1, version: 2 }, // version should be stripped
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend[0].data).toEqual({
        name: "Test Order",
        status: 1,
        version: 1, // Original CREATE version preserved
      });
    });
  });

  describe("CREATE + DELETE coalescing", () => {
    it("should cancel out CREATE + DELETE (returns empty)", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          sequence_number: 1,
          entity_id: "entity-123",
          operation_type: "CREATE",
          data: { name: "Test Order", status: 0 },
        }),
        createMockOperation({
          id: "op-2",
          sequence_number: 2,
          entity_id: "entity-123",
          operation_type: "DELETE",
          data: {},
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(0);
      expect(result.toRemoveIds).toEqual(["op-1", "op-2"]);
    });

    it("should cancel out CREATE + UPDATE + DELETE (returns empty)", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          sequence_number: 1,
          entity_id: "entity-123",
          operation_type: "CREATE",
        }),
        createMockOperation({
          id: "op-2",
          sequence_number: 2,
          entity_id: "entity-123",
          operation_type: "UPDATE",
        }),
        createMockOperation({
          id: "op-3",
          sequence_number: 3,
          entity_id: "entity-123",
          operation_type: "DELETE",
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(0);
      expect(result.toRemoveIds).toEqual(["op-1", "op-2", "op-3"]);
    });

    it("should cancel out CREATE + multiple UPDATEs + DELETE", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "CREATE",
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
        }),
        createMockOperation({
          id: "op-3",
          entity_id: "entity-123",
          operation_type: "UPDATE",
        }),
        createMockOperation({
          id: "op-4",
          entity_id: "entity-123",
          operation_type: "DELETE",
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(0);
      expect(result.toRemoveIds).toEqual(["op-1", "op-2", "op-3", "op-4"]);
    });
  });

  describe("Multiple UPDATEs coalescing", () => {
    it("should merge 2 UPDATEs into single UPDATE", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          sequence_number: 1,
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1, version: 1 },
          timestamp: "2024-01-01T10:00:00Z",
        }),
        createMockOperation({
          id: "op-2",
          sequence_number: 2,
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { comment: "Updated", version: 2 },
          timestamp: "2024-01-01T10:05:00Z",
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0]).toMatchObject({
        id: "op-1",
        operation_type: "UPDATE",
        data: { status: 1, comment: "Updated", version: 1 }, // First version kept
        timestamp: "2024-01-01T10:05:00Z", // Last timestamp
      });
      expect(result.toRemoveIds).toEqual(["op-2"]);
    });

    it("should merge 3+ UPDATEs into single UPDATE", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1, version: 1 },
          timestamp: "2024-01-01T10:00:00Z",
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { comment: "Updated", version: 2 },
          timestamp: "2024-01-01T10:05:00Z",
        }),
        createMockOperation({
          id: "op-3",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { order_date: "2024-01-15", version: 3 },
          timestamp: "2024-01-01T10:10:00Z",
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0]).toMatchObject({
        id: "op-1",
        operation_type: "UPDATE",
        data: {
          status: 1,
          comment: "Updated",
          order_date: "2024-01-15",
          version: 1,
        },
        timestamp: "2024-01-01T10:10:00Z",
      });
      expect(result.toRemoveIds).toEqual(["op-2", "op-3"]);
    });

    it("should preserve first UPDATE expected_version", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1, version: 5 }, // Expected version 5
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { comment: "Updated", version: 6 },
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend[0].data).toMatchObject({
        version: 5, // First UPDATE version preserved
      });
    });

    it("should override overlapping fields (last wins)", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1 },
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 2 }, // Overrides previous status
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend[0].data).toEqual({ status: 2 });
    });
  });

  describe("UPDATE + DELETE coalescing", () => {
    it("should keep only DELETE when UPDATE + DELETE", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          sequence_number: 1,
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1 },
        }),
        createMockOperation({
          id: "op-2",
          sequence_number: 2,
          entity_id: "entity-123",
          operation_type: "DELETE",
          data: {},
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0]).toMatchObject({
        id: "op-2",
        operation_type: "DELETE",
      });
      expect(result.toRemoveIds).toEqual(["op-1"]); // UPDATE is coalesced away
    });

    it("should keep only DELETE when multiple UPDATEs + DELETE", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "UPDATE",
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
        }),
        createMockOperation({
          id: "op-3",
          entity_id: "entity-123",
          operation_type: "DELETE",
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0]).toMatchObject({
        id: "op-3",
        entity_id: "entity-123",
        operation_type: "DELETE",
      });
      expect(result.toRemoveIds).toEqual(["op-1", "op-2"]); // UPDATEs are coalesced away
    });
  });

  describe("Multiple entities grouping", () => {
    it("should coalesce operations for same entity separately", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "CREATE",
          data: { name: "Order 1" },
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1 },
        }),
        createMockOperation({
          id: "op-3",
          entity_id: "entity-456",
          operation_type: "CREATE",
          data: { name: "Order 2" },
        }),
        createMockOperation({
          id: "op-4",
          entity_id: "entity-456",
          operation_type: "UPDATE",
          data: { status: 1 },
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      // Should have 2 coalesced operations (one per entity)
      expect(result.toSend).toHaveLength(2);

      // First entity
      expect(result.toSend[0]).toMatchObject({
        entity_id: "entity-123",
        operation_type: "CREATE",
        data: { name: "Order 1", status: 1 },
      });

      // Second entity
      expect(result.toSend[1]).toMatchObject({
        entity_id: "entity-456",
        operation_type: "CREATE",
        data: { name: "Order 2", status: 1 },
      });

      expect(result.toRemoveIds).toEqual(["op-2", "op-4"]);
    });

    it("should not mix operations from different entities", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "CREATE",
          data: { name: "Order 1" },
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-456",
          operation_type: "CREATE",
          data: { name: "Order 2" },
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(2);
      expect(result.toSend[0].entity_id).toBe("entity-123");
      expect(result.toSend[1].entity_id).toBe("entity-456");
    });

    it("should preserve sequence order within groups", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          sequence_number: 1,
          entity_id: "entity-123",
          operation_type: "CREATE",
        }),
        createMockOperation({
          id: "op-2",
          sequence_number: 2,
          entity_id: "entity-456",
          operation_type: "CREATE",
        }),
        createMockOperation({
          id: "op-3",
          sequence_number: 3,
          entity_id: "entity-123",
          operation_type: "UPDATE",
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      // Entity 123 should have CREATE + UPDATE merged
      const entity123 = result.toSend.find(
        (op: OutboxOperation) => op.entity_id === "entity-123",
      );
      expect(entity123?.operation_type).toBe("CREATE");

      // Entity 456 should have CREATE unchanged
      const entity456 = result.toSend.find(
        (op: OutboxOperation) => op.entity_id === "entity-456",
      );
      expect(entity456?.operation_type).toBe("CREATE");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty array (no operations)", () => {
      const operations: any[] = [];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(0);
      expect(result.toRemoveIds).toHaveLength(0);
    });

    it("should handle operations with null/undefined data fields", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "CREATE",
          data: { name: "Order", comment: null },
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1 },
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0].data).toEqual({
        name: "Order",
        comment: null,
        status: 1,
      });
    });

    it("should handle operations with empty data objects", () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "DELETE",
          data: {},
        }),
      ];

      const result = (pushService as any).coalesceOperations(operations);

      expect(result.toSend).toHaveLength(1);
      expect(result.toSend[0].data).toEqual({});
    });
  });
});

describe("PushService.pushOperations()", () => {
  let pushService: PushService;
  let mockDB: ReturnType<typeof createMockSyncDB>;

  beforeEach(() => {
    mockDB = createMockSyncDB();
    pushService = new PushService(mockDB);

    // Clear mock API and logger history (but keep implementation)
    vi.mocked(mockApi.syncPush).mockClear();
    vi.mocked(mockApi.syncPush).mockResolvedValue({ results: [] });
    vi.mocked(mockLogger.info).mockClear();
    vi.mocked(mockLogger.warn).mockClear();
    vi.mocked(mockLogger.error).mockClear();

    // Clear table mocks
    vi.mocked(mockDB.pre_orders.update).mockClear();
    vi.mocked(mockDB.pre_orders.get).mockClear();
    vi.mocked(mockDB.pre_order_flows.update).mockClear();
    vi.mocked(mockDB.pre_order_flows.get).mockClear();
    vi.mocked(mockDB.pre_order_flows.get).mockResolvedValue(undefined);

    // Clear QueryInvalidator mock
    vi.mocked(queryInvalidator.invalidatePreOrdersByIds).mockClear();
  });

  // Helper to create mock API results
  function createMockResult(
    overrides: Partial<PushOperationResult>,
  ): PushOperationResult {
    return {
      operation_id: overrides.operation_id ?? "op-1",
      status: overrides.status ?? "success",
      sync_id: overrides.sync_id ?? 100,
      new_version: overrides.new_version ?? 2,
      message: overrides.message ?? null,
      conflicts: overrides.conflicts ?? null,
    };
  }

  describe("Basic operations", () => {
    it("should return empty result when no pending operations", async () => {
      mockDB.getPendingOperations.mockResolvedValue([]);

      const result = await pushService.pushOperations();

      expect(result).toEqual({
        processedCount: 0,
        successCount: 0,
        failedCount: 0,
        errors: [],
      });
      expect(mockApi.syncPush).not.toHaveBeenCalled();
    });

    it("should handle when all operations cancel out (CREATE+DELETE)", async () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          operation_type: "CREATE",
          entity_id: "entity-123",
        }),
        createMockOperation({
          id: "op-2",
          operation_type: "DELETE",
          entity_id: "entity-123",
        }),
      ];

      mockDB.getPendingOperations.mockResolvedValue(operations);

      const result = await pushService.pushOperations();

      expect(result.processedCount).toBe(2);
      expect(result.successCount).toBe(2); // Coalesced = success
      expect(mockDB.markOperationsSynced).toHaveBeenCalledWith([
        "op-1",
        "op-2",
      ]);
      expect(mockApi.syncPush).not.toHaveBeenCalled();
    });
  });

  describe("Success handling", () => {
    it("should mark operation as synced on API success", async () => {
      const operation = createMockOperation({
        id: "op-1",
        entity_type: "pre_order",
        entity_id: "entity-123",
        operation_type: "CREATE",
        data: { name: "Order 1", version: 1 },
      });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "success",
            new_version: 2,
          }),
        ],
      });

      const result = await pushService.pushOperations();

      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(mockDB.markOperationsSyncing).toHaveBeenCalledWith(["op-1"]);
      expect(mockDB.markOperationSynced).toHaveBeenCalledWith("op-1");
      expect(mockDB.updateEntityVersion).toHaveBeenCalledWith(
        "pre_order",
        "entity-123",
        2,
      );
    });

    it("should update last_push_timestamp on success", async () => {
      const operation = createMockOperation({ id: "op-1" });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({ operation_id: "op-1", status: "success" }),
        ],
      });

      await pushService.pushOperations();

      expect(mockDB.metadata.put).toHaveBeenCalledWith({
        key: "last_push_timestamp",
        value: expect.any(String),
      });
    });

    it("should NOT update last_push_timestamp if all operations fail", async () => {
      const operation = createMockOperation({ id: "op-1" });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "error",
            message: "Validation failed",
          }),
        ],
      });

      await pushService.pushOperations();

      expect(mockDB.metadata.put).not.toHaveBeenCalled();
    });
  });

  describe("Conflict handling", () => {
    it("should handle conflicts as success but log warning", async () => {
      const operation = createMockOperation({ id: "op-1" });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "conflict",
            message: "Server won",
            conflicts: [
              {
                field: "status",
                client_value: 0,
                server_value: 1,
                winner: "server",
              },
            ],
            new_version: 3,
          }),
        ],
      });

      const result = await pushService.pushOperations();

      // Conflict is considered "success" (handled by server)
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(mockDB.markOperationSynced).toHaveBeenCalledWith("op-1");
      expect(mockDB.updateEntityVersion).toHaveBeenCalledWith(
        "pre_order",
        expect.any(String),
        3,
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("resolved with conflicts"),
        expect.any(String),
        expect.any(Array),
      );
    });

    it("should update entity in DB when server wins conflict", async () => {
      const operation = createMockOperation({
        id: "op-1",
        entity_type: "pre_order",
        entity_id: "entity-123",
        operation_type: "UPDATE",
      });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "conflict",
            message: "Server values applied",
            conflicts: [
              {
                field: "status",
                client_value: 0,
                server_value: 2,
                winner: "server",
              },
              {
                field: "comment",
                client_value: "Client comment",
                server_value: "Server comment",
                winner: "server",
              },
            ],
            new_version: 5,
          }),
        ],
      });

      await pushService.pushOperations();

      // Verify entity is updated with server values
      expect(mockDB.pre_orders.update).toHaveBeenCalledWith("entity-123", {
        status: 2,
        comment: "Server comment",
      });
    });

    it("should update pre_order_flow entity when server wins conflict", async () => {
      const operation = createMockOperation({
        id: "op-1",
        entity_type: "pre_order_flow",
        entity_id: "flow-456",
        operation_type: "UPDATE",
      });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "conflict",
            message: "Server values applied",
            conflicts: [
              {
                field: "quantity",
                client_value: 10,
                server_value: 15,
                winner: "server",
              },
            ],
            new_version: 3,
          }),
        ],
      });

      await pushService.pushOperations();

      // Verify pre_order_flow entity is updated
      expect(mockDB.pre_order_flows.update).toHaveBeenCalledWith("flow-456", {
        quantity: 15,
      });
    });

    it("should not update entity when client wins conflict", async () => {
      const operation = createMockOperation({
        id: "op-1",
        entity_type: "pre_order",
        entity_id: "entity-123",
        operation_type: "UPDATE",
      });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "conflict",
            message: "Client values kept",
            conflicts: [
              {
                field: "status",
                client_value: 1,
                server_value: 0,
                winner: "client",
              },
            ],
            new_version: 4,
          }),
        ],
      });

      await pushService.pushOperations();

      // Verify entity is NOT updated when client wins
      expect(mockDB.pre_orders.update).not.toHaveBeenCalled();
    });

    it("should update only server-won fields in mixed conflict", async () => {
      const operation = createMockOperation({
        id: "op-1",
        entity_type: "pre_order",
        entity_id: "entity-123",
        operation_type: "UPDATE",
      });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "conflict",
            message: "Mixed resolution",
            conflicts: [
              {
                field: "status",
                client_value: 0,
                server_value: 2,
                winner: "server",
              },
              {
                field: "comment",
                client_value: "Client comment",
                server_value: "Server comment",
                winner: "client",
              },
              {
                field: "delivery_date",
                client_value: "2024-01-15",
                server_value: "2024-01-20",
                winner: "server",
              },
            ],
            new_version: 6,
          }),
        ],
      });

      await pushService.pushOperations();

      // Verify only server-won fields are updated
      expect(mockDB.pre_orders.update).toHaveBeenCalledWith("entity-123", {
        status: 2,
        delivery_date: "2024-01-20",
        // comment should NOT be included since client won
      });
    });

    it("should handle conflict with no conflicts array", async () => {
      const operation = createMockOperation({
        id: "op-1",
        entity_type: "pre_order",
        entity_id: "entity-123",
      });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "conflict",
            message: "Conflict resolved",
            conflicts: null,
            new_version: 2,
          }),
        ],
      });

      const result = await pushService.pushOperations();

      // Should not crash when conflicts is null
      expect(result.successCount).toBe(1);
      expect(mockDB.pre_orders.update).not.toHaveBeenCalled();
    });

    it("should invalidate cache for affected pre_orders", async () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_type: "pre_order",
          entity_id: "pre-order-1",
          operation_type: "UPDATE",
        }),
        createMockOperation({
          id: "op-2",
          entity_type: "pre_order",
          entity_id: "pre-order-2",
          operation_type: "UPDATE",
        }),
      ];

      mockDB.getPendingOperations.mockResolvedValue(operations);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "conflict",
            conflicts: [
              {
                field: "status",
                client_value: 0,
                server_value: 1,
                winner: "server",
              },
            ],
            new_version: 3,
          }),
          createMockResult({
            operation_id: "op-2",
            status: "success",
            new_version: 2,
          }),
        ],
      });

      await pushService.pushOperations();

      // Verify cache invalidation called with affected pre_order IDs
      expect(queryInvalidator.invalidatePreOrdersByIds).toHaveBeenCalledWith(
        expect.arrayContaining(["pre-order-1", "pre-order-2"]),
      );
      expect(queryInvalidator.invalidatePreOrdersByIds).toHaveBeenCalledTimes(
        1,
      );
    });

    it("should invalidate cache for pre_order_flow by extracting pre_order_id from data", async () => {
      const operation = createMockOperation({
        id: "op-1",
        entity_type: "pre_order_flow",
        entity_id: "flow-123",
        operation_type: "UPDATE",
        data: { pre_order_id: "pre-order-999", quantity: 10 },
      });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "success",
            new_version: 2,
          }),
        ],
      });

      await pushService.pushOperations();

      // Should invalidate cache using pre_order_id from flow data
      expect(queryInvalidator.invalidatePreOrdersByIds).toHaveBeenCalledWith([
        "pre-order-999",
      ]);
    });

    it("should invalidate cache for pre_order_flow by fetching from DB when data missing pre_order_id", async () => {
      const operation = createMockOperation({
        id: "op-1",
        entity_type: "pre_order_flow",
        entity_id: "flow-456",
        operation_type: "UPDATE",
        data: { quantity: 15 }, // No pre_order_id in data
      });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      vi.mocked(mockDB.pre_order_flows.get).mockResolvedValue({
        id: "flow-456",
        pre_order_id: "pre-order-888",
        product_id: "prod-1",
        unit_id: "unit-1",
        quantity: 15,
        price: 100,
        comment: null,
        created_at: null,
        updated_at: null,
        version: 2,
      });

      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "success",
            new_version: 2,
          }),
        ],
      });

      await pushService.pushOperations();

      // Should fetch flow from DB and get pre_order_id
      expect(mockDB.pre_order_flows.get).toHaveBeenCalledWith("flow-456");
      expect(queryInvalidator.invalidatePreOrdersByIds).toHaveBeenCalledWith([
        "pre-order-888",
      ]);
    });

    it("should handle flow without pre_order_id gracefully", async () => {
      const operation = createMockOperation({
        id: "op-1",
        entity_type: "pre_order_flow",
        entity_id: "flow-deleted",
        operation_type: "DELETE",
        data: {}, // No pre_order_id in data
      });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      vi.mocked(mockDB.pre_order_flows.get).mockResolvedValue(undefined); // Flow doesn't exist

      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "success",
            new_version: null,
          }),
        ],
      });

      await pushService.pushOperations();

      // Should not crash and should not invalidate cache
      expect(queryInvalidator.invalidatePreOrdersByIds).not.toHaveBeenCalled();
    });

    it("should not invalidate cache when no operations succeed", async () => {
      const operation = createMockOperation({
        id: "op-1",
        entity_type: "pre_order",
        entity_id: "pre-order-1",
      });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "error",
            message: "Validation failed",
          }),
        ],
      });

      await pushService.pushOperations();

      // Should not invalidate cache when all operations failed
      expect(queryInvalidator.invalidatePreOrdersByIds).not.toHaveBeenCalled();
    });
  });

  describe("Rejection handling", () => {
    it("should mark operation as rejected on server error", async () => {
      const operation = createMockOperation({ id: "op-1" });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({
            operation_id: "op-1",
            status: "error",
            message: "Invalid data format",
          }),
        ],
      });

      const result = await pushService.pushOperations();

      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        operationId: "op-1",
        error: expect.any(Error),
      });
      expect(mockDB.markOperationRejected).toHaveBeenCalledWith(
        "op-1",
        "Invalid data format",
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("rejected"),
        expect.any(String),
      );
    });

    it("should handle mixed success/conflict/error results", async () => {
      const operations = [
        createMockOperation({ id: "op-1" }),
        createMockOperation({ id: "op-2" }),
        createMockOperation({ id: "op-3" }),
      ];

      mockDB.getPendingOperations.mockResolvedValue(operations);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({ operation_id: "op-1", status: "success" }),
          createMockResult({ operation_id: "op-2", status: "conflict" }),
          createMockResult({
            operation_id: "op-3",
            status: "error",
            message: "Failed",
          }),
        ],
      });

      const result = await pushService.pushOperations();

      expect(result.processedCount).toBe(3);
      expect(result.successCount).toBe(2); // success + conflict
      expect(result.failedCount).toBe(1); // error
      expect(mockDB.markOperationSynced).toHaveBeenCalledTimes(2);
      expect(mockDB.markOperationRejected).toHaveBeenCalledTimes(1);
    });
  });

  describe("Retry logic", () => {
    it("should mark operations as failed on network error", async () => {
      const operation = createMockOperation({ id: "op-1" });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockRejectedValue(new Error("Network timeout"));

      const result = await pushService.pushOperations();

      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        operationId: "batch",
        error: expect.any(Error),
      });
      expect(mockDB.markOperationFailed).toHaveBeenCalledWith(
        "op-1",
        "Network timeout",
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("network error"),
        expect.any(Error),
      );
    });

    it("should mark all operations as failed on batch network error", async () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-1",
          operation_type: "CREATE",
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-2",
          operation_type: "CREATE",
        }),
        createMockOperation({
          id: "op-3",
          entity_id: "entity-3",
          operation_type: "CREATE",
        }),
      ];

      mockDB.getPendingOperations.mockResolvedValue(operations);
      mockApi.syncPush.mockRejectedValue(
        new Error("500 Internal Server Error"),
      );

      const result = await pushService.pushOperations();

      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(3);
      expect(mockDB.markOperationFailed).toHaveBeenCalledTimes(3);
      expect(mockDB.markOperationFailed).toHaveBeenCalledWith(
        "op-1",
        "500 Internal Server Error",
      );
      expect(mockDB.markOperationFailed).toHaveBeenCalledWith(
        "op-2",
        "500 Internal Server Error",
      );
      expect(mockDB.markOperationFailed).toHaveBeenCalledWith(
        "op-3",
        "500 Internal Server Error",
      );
    });
  });

  describe("Orchestration", () => {
    it("should mark operations as syncing before API call", async () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-1",
          operation_type: "CREATE",
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-2",
          operation_type: "CREATE",
        }),
      ];

      mockDB.getPendingOperations.mockResolvedValue(operations);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({ operation_id: "op-1" }),
          createMockResult({ operation_id: "op-2" }),
        ],
      });

      await pushService.pushOperations();

      expect(mockDB.markOperationsSyncing).toHaveBeenCalledWith([
        "op-1",
        "op-2",
      ]);

      // Verify that markOperationsSyncing is called BEFORE syncPush
      const mockCallOrder =
        mockDB.markOperationsSyncing.mock.invocationCallOrder[0];
      const apiCallOrder = mockApi.syncPush.mock.invocationCallOrder[0];
      expect(mockCallOrder).toBeLessThan(apiCallOrder);
    });

    it("should coalesce operations before sending to API", async () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "entity-123",
          operation_type: "CREATE",
          data: { name: "Order 1" },
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "entity-123",
          operation_type: "UPDATE",
          data: { status: 1 },
        }),
      ];

      mockDB.getPendingOperations.mockResolvedValue(operations);
      mockApi.syncPush.mockResolvedValue({
        results: [createMockResult({ operation_id: "op-1" })],
      });

      await pushService.pushOperations();

      // Only 1 operation sent (CREATE merged with UPDATE)
      expect(mockApi.syncPush).toHaveBeenCalledWith({
        operations: expect.arrayContaining([
          expect.objectContaining({
            id: "op-1",
            operation_type: "CREATE",
            data: expect.objectContaining({
              name: "Order 1",
              status: 1,
            }),
          }),
        ]),
      });
      expect(mockApi.syncPush.mock.calls[0][0].operations).toHaveLength(1);
      expect(mockDB.markOperationsSynced).toHaveBeenCalledWith(["op-2"]);
    });
  });

  describe("Edge cases", () => {
    it("should handle non-Error exceptions in catch block", async () => {
      const operation = createMockOperation({ id: "op-1" });

      mockDB.getPendingOperations.mockResolvedValue([operation]);
      mockApi.syncPush.mockRejectedValue("String error");

      const result = await pushService.pushOperations();

      expect(result.failedCount).toBe(1);
      expect(mockDB.markOperationFailed).toHaveBeenCalledWith(
        "op-1",
        "String error",
      );
    });

    it("should count all processed operations including coalesced ones", async () => {
      const operations = [
        createMockOperation({
          id: "op-1",
          entity_id: "e1",
          operation_type: "CREATE",
        }),
        createMockOperation({
          id: "op-2",
          entity_id: "e1",
          operation_type: "UPDATE",
        }),
        createMockOperation({
          id: "op-3",
          entity_id: "e2",
          operation_type: "CREATE",
        }),
      ];

      mockDB.getPendingOperations.mockResolvedValue(operations);
      mockApi.syncPush.mockResolvedValue({
        results: [
          createMockResult({ operation_id: "op-1" }),
          createMockResult({ operation_id: "op-3" }),
        ],
      });

      const result = await pushService.pushOperations();

      expect(result.processedCount).toBe(3); // All 3 counted
      expect(result.successCount).toBe(2); // 2 sent to API
    });
  });
});
