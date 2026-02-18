import { vi } from "vitest";

export const mockQueryInvalidator = {
  invalidatePreOrdersByIds: vi.fn(),
  invalidateAll: vi.fn(),
  registerQueryClient: vi.fn(),
};

// Mock global of the QueryInvalidator module
vi.mock("@/lib/sync/QueryInvalidator", () => ({
  queryInvalidator: mockQueryInvalidator,
}));
