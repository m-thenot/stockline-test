import { beforeEach, vi } from "vitest";

// Mock console.log/warn/error to avoid polluting test output
// (unless process.env.DEBUG is set)
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// Reset all mocks between each test for isolation
beforeEach(() => {
  vi.clearAllMocks();
});
