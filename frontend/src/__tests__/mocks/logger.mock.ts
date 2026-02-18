import { vi } from "vitest";

export const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
};

// Mock global of the logger module
vi.mock("@/lib/utils/logger", () => ({
  logger: mockLogger,
}));
