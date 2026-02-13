import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

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
    mutationFn: (data: {
      partner_id: string;
      delivery_date: string;
      status?: number;
      comment?: string;
    }) => api.createPreOrder(data),
    onSuccess: invalidateRecap,
  });

  const updatePreOrder = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.updatePreOrder(id, data),
    onSuccess: invalidateRecap,
  });

  const deletePreOrder = useMutation({
    mutationFn: (id: string) => api.deletePreOrder(id),
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
