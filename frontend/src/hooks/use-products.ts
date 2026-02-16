import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/db";

export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: () => db.products.toArray(),
    staleTime: Infinity,
  });
}
