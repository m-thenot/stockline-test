import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/db";

export function useUnits() {
  return useQuery({
    queryKey: ["units"],
    queryFn: () => db.units.toArray(),
    staleTime: Infinity,
  });
}
