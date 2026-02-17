"use client";

import { useState, useEffect } from "react";
import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
} from "@tanstack/react-query";
import { SyncManager } from "@/lib/sync";
import { queryInvalidator } from "@/lib/sync/QueryInvalidator";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const mutationCache = new MutationCache({
      onSuccess: () => {
        const syncManager = SyncManager.getInstance();
        syncManager.push().catch(() => {});
      },
    });

    return new QueryClient({
      mutationCache,
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: 1,
          staleTime: Infinity,
          networkMode: "always",
        },
        mutations: {
          networkMode: "always",
        },
      },
    });
  });

  useEffect(() => {
    queryInvalidator.registerQueryClient(queryClient);

    const syncManager = SyncManager.getInstance();
    syncManager.start();

    return () => {
      syncManager.stop();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
