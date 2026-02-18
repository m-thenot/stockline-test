import { PushRequestBody, PushResponseBody } from "@/lib/sync";
import { vi } from "vitest";

export const mockApi = {
  syncPush: vi.fn<(body: PushRequestBody) => Promise<PushResponseBody>>(),
};
// Mock global of the api module
vi.mock("@/lib/api", () => ({
  api: mockApi,
}));
