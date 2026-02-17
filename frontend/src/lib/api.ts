import type {
  Product,
  Partner,
  Unit,
  PreOrder,
  PreOrderFlow,
  RecapGroup,
} from "./types";
import type {
  Partner as DbPartner,
  Product as DbProduct,
  Unit as DbUnit,
  PreOrder as DbPreOrder,
  PreOrderFlow as DbPreOrderFlow,
} from "./db/models";
import type {
  PullResponse,
  PushRequestBody,
  PushResponseBody,
} from "./sync/types";

export interface SnapshotData {
  partners: DbPartner[];
  products: DbProduct[];
  units: DbUnit[];
  pre_orders: Omit<DbPreOrder, "version">[];
  flows: Omit<DbPreOrderFlow, "version">[];
}

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  getProducts: () => request<Product[]>("/products"),
  getPartners: () => request<Partner[]>("/partners"),
  getUnits: () => request<Unit[]>("/units"),
  getRecap: (date: string) =>
    request<RecapGroup[]>(`/pre-orders/recap/${date}`),
  createPreOrder: (data: {
    partner_id: string;
    delivery_date: string;
    status?: number;
    comment?: string;
  }) =>
    request<PreOrder>("/pre-orders", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updatePreOrder: (id: string, data: Record<string, unknown>) =>
    request<PreOrder>(`/pre-orders/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deletePreOrder: (id: string) =>
    request<{ ok: boolean }>(`/pre-orders/${id}`, { method: "DELETE" }),
  createFlow: (preOrderId: string, data: Record<string, unknown>) =>
    request<PreOrderFlow>(`/pre-orders/${preOrderId}/flows`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateFlow: (id: string, data: Record<string, unknown>) =>
    request<PreOrderFlow>(`/flows/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteFlow: (id: string) =>
    request<{ ok: boolean }>(`/flows/${id}`, { method: "DELETE" }),
  getSnapshot: () => request<SnapshotData>("/sync/snapshot"),
  syncPush: (body: PushRequestBody) =>
    request<PushResponseBody>("/sync/push", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  pullOperations: (sinceSyncId: number, limit?: number) =>
    request<PullResponse>(
      `/sync/pull?since_sync_id=${sinceSyncId}&limit=${limit ?? 100}`,
    ),
};
