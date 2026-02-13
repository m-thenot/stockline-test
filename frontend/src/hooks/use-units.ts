import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useUnits() {
  return useQuery({
    queryKey: ["units"],
    queryFn: api.getUnits,
    staleTime: 5 * 60 * 1000,
  });
}
