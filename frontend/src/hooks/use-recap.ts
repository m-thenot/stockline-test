import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/db";
import {
  preOrderRepository,
  preOrderFlowRepository,
} from "@/lib/db/repositories";
import type { RecapGroup } from "@/lib/types";

async function getRecapFromLocalDb(date: string): Promise<RecapGroup[]> {
  const preOrders = await db.pre_orders
    .where("delivery_date")
    .equals(date)
    .toArray();

  if (preOrders.length === 0) return [];

  // Batch-load all reference data once
  const [allPartners, allProducts, allUnits] = await Promise.all([
    db.partners.toArray(),
    db.products.toArray(),
    db.units.toArray(),
  ]);

  const partnersMap = new Map(allPartners.map((p) => [p.id, p]));
  const productsMap = new Map(allProducts.map((p) => [p.id, p]));
  const unitsMap = new Map(allUnits.map((u) => [u.id, u]));

  // Load flows for all pre-orders in this date
  const preOrderIds = preOrders.map((po) => po.id);
  const allFlows = await db.pre_order_flows
    .where("pre_order_id")
    .anyOf(preOrderIds)
    .toArray();

  // Group flows by pre_order_id
  const flowsByPreOrderId = new Map<string, typeof allFlows>();
  for (const flow of allFlows) {
    const list = flowsByPreOrderId.get(flow.pre_order_id) ?? [];
    list.push(flow);
    flowsByPreOrderId.set(flow.pre_order_id, list);
  }

  // Group pre-orders by partner
  const groupMap = new Map<string, RecapGroup>();

  for (const po of preOrders) {
    const partner = partnersMap.get(po.partner_id);
    if (!partner) continue;

    const flows = (flowsByPreOrderId.get(po.id) ?? []).map((f) => ({
      id: f.id,
      pre_order_id: f.pre_order_id,
      product_id: f.product_id,
      quantity: f.quantity,
      price: f.price,
      unit_id: f.unit_id,
      comment: f.comment,
      created_at: f.created_at,
      updated_at: f.updated_at,
      product: productsMap.get(f.product_id) ?? null,
      unit: unitsMap.get(f.unit_id) ?? null,
    }));

    const enrichedOrder = {
      id: po.id,
      partner_id: po.partner_id,
      status: po.status,
      order_date: po.order_date,
      delivery_date: po.delivery_date,
      comment: po.comment,
      created_at: po.created_at,
      updated_at: po.updated_at,
      partner,
      flows,
    };

    const group = groupMap.get(po.partner_id);
    if (group) {
      group.pre_orders.push(enrichedOrder);
    } else {
      groupMap.set(po.partner_id, {
        partner,
        pre_orders: [enrichedOrder],
      });
    }
  }

  return Array.from(groupMap.values());
}

export function useRecap(date: string) {
  const queryClient = useQueryClient();

  const recapQuery = useQuery({
    queryKey: ["recap", date],
    queryFn: () => getRecapFromLocalDb(date),
    staleTime: Infinity,
  });

  const invalidateRecap = () => {
    queryClient.invalidateQueries({ queryKey: ["recap", date] });
  };

  const createPreOrder = useMutation({
    mutationFn: async (data: {
      partner_id: string;
      delivery_date: string;
      status?: number;
      comment?: string;
    }) => {
      const order = await preOrderRepository.create({
        partner_id: data.partner_id,
        delivery_date: data.delivery_date,
        status: data.status ?? 0,
        order_date: null,
        comment: data.comment ?? null,
      });
      return order;
    },
    onSuccess: invalidateRecap,
  });

  const updatePreOrder = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Record<string, unknown>;
    }) => {
      const order = await preOrderRepository.update(id, data);
      return order;
    },
    onSuccess: invalidateRecap,
  });

  const deletePreOrder = useMutation({
    mutationFn: async (id: string) => {
      await preOrderRepository.delete(id);
    },
    onSuccess: invalidateRecap,
  });

  const createFlow = useMutation({
    mutationFn: async ({
      preOrderId,
      data,
    }: {
      preOrderId: string;
      data: {
        product_id: string;
        unit_id: string;
        quantity: number;
        price: number;
        comment?: string | null;
      };
    }) => {
      const flow = await preOrderFlowRepository.create({
        pre_order_id: preOrderId,
        product_id: data.product_id,
        unit_id: data.unit_id,
        quantity: data.quantity,
        price: data.price,
        comment: data.comment ?? null,
      });
      return flow;
    },
    onSuccess: invalidateRecap,
  });

  const updateFlow = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Record<string, unknown>;
    }) => {
      const flow = await preOrderFlowRepository.update(id, data);
      return flow;
    },
    onSuccess: invalidateRecap,
  });

  const deleteFlow = useMutation({
    mutationFn: async (id: string) => {
      await preOrderFlowRepository.delete(id);
    },
    onSuccess: invalidateRecap,
  });

  return {
    ...recapQuery,
    createPreOrder,
    updatePreOrder,
    deletePreOrder,
    createFlow,
    updateFlow,
    deleteFlow,
  };
}
