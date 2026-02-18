import { vi } from "vitest";

export const mockApi = {
  syncPush: vi.fn(() => Promise.resolve({ results: [] })),
};

// Mock global of the api module
vi.mock("@/lib/api", () => ({
  api: mockApi,
}));
