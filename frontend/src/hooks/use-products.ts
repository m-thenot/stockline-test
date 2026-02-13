import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: api.getProducts,
    staleTime: 5 * 60 * 1000,
  });
}
