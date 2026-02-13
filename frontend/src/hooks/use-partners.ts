import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function usePartners() {
  return useQuery({
    queryKey: ["partners"],
    queryFn: api.getPartners,
    staleTime: 5 * 60 * 1000,
  });
}
