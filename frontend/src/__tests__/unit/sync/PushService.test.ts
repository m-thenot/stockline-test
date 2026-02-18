import { describe, it, expect, beforeEach } from "vitest";
import { PushService } from "@/lib/sync/PushService";
import { createMockSyncDB, createMockOperation } from "../../mocks/syncdb.mock";
import "../../mocks/api.mock";
import "../../mocks/logger.mock";
import { OutboxOperation } from "@/lib/db/models";

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
