import { PushRequestBody, PushResponseBody, PullResponse } from "@/lib/sync";
import { SnapshotData } from "@/lib/api";
import { vi } from "vitest";

export const mockApi = {
  syncPush: vi.fn<(body: PushRequestBody) => Promise<PushResponseBody>>(),
  getSnapshot: vi.fn<() => Promise<SnapshotData>>(),
  pullOperations:
    vi.fn<(sinceSyncId: number, limit?: number) => Promise<PullResponse>>(),
};
// Mock global of the api module
vi.mock("@/lib/api", () => ({
  api: mockApi,
}));
