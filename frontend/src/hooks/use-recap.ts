import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { preOrderRepository } from "@/lib/db/repositories";

export function useRecap(date: string) {
  const queryClient = useQueryClient();

  const recapQuery = useQuery({
    queryKey: ["recap", date],
    queryFn: () => api.getRecap(date),
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
        comment: data.comment,
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
    mutationFn: ({
      preOrderId,
      data,
    }: {
      preOrderId: string;
      data: Record<string, unknown>;
    }) => api.createFlow(preOrderId, data),
    onSuccess: invalidateRecap,
  });

  const updateFlow = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.updateFlow(id, data),
    onSuccess: invalidateRecap,
  });

  const deleteFlow = useMutation({
    mutationFn: (id: string) => api.deleteFlow(id),
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
