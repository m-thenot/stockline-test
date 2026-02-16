import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/db";

export function usePartners() {
  return useQuery({
    queryKey: ["partners"],
    queryFn: () => db.partners.toArray(),
    staleTime: Infinity,
  });
}
