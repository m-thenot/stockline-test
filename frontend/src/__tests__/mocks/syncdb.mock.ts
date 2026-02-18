import { Mocked, vi } from "vitest";
import type { SyncDB } from "@/lib/db";
import type { OutboxOperation } from "@/lib/db/models";

/**
 * Create a mock SyncDB instance with all necessary methods
 * Each method is a vi.fn() spy that can be configured per test
 */
export function createMockSyncDB(): Mocked<SyncDB> {
  const mockDB = {
    // Outbox operations
    getPendingOperations: vi.fn(() => Promise.resolve([])),
    markOperationsSyncing: vi.fn(() => Promise.resolve()),
    markOperationSynced: vi.fn(() => Promise.resolve()),
    markOperationFailed: vi.fn(() => Promise.resolve()),
    markOperationRejected: vi.fn(() => Promise.resolve()),
    markOperationsSynced: vi.fn(() => Promise.resolve()),
    updateEntityVersion: vi.fn(() => Promise.resolve()),

    // Metadata
    metadata: {
      put: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve(undefined)),
    },

    // Entity tables
    pre_orders: {
      update: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve(undefined)),
    },
    pre_order_flows: {
      update: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve(undefined)),
    },

    // Other methods (if needed)
    getLastSyncId: vi.fn(() => Promise.resolve(0)),
    setLastSyncId: vi.fn(() => Promise.resolve()),
    getNextSequenceNumber: vi.fn(() => Promise.resolve(1)),
    addOutboxOperation: vi.fn(() => Promise.resolve()),
  } as unknown as SyncDB;

  return mockDB as Mocked<SyncDB>;
}

/**
 * Helper to create mock OutboxOperation entities
 */
export function createMockOperation(
  overrides: Partial<OutboxOperation>,
): OutboxOperation {
  return {
    id: overrides.id ?? "op-1",
    sequence_number: overrides.sequence_number ?? 1,
    entity_type: overrides.entity_type ?? "pre_order",
    entity_id: overrides.entity_id ?? "entity-123",
    operation_type: overrides.operation_type ?? "CREATE",
    data: overrides.data ?? {},
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    status: overrides.status ?? "pending",
    retry_count: overrides.retry_count ?? 0,
    next_retry_at: overrides.next_retry_at ?? null,
    last_error: overrides.last_error ?? null,
  };
}
