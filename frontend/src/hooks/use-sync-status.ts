import { useSyncExternalStore } from "react";
import { SyncManager } from "@/lib/sync";
import type { SyncStatus } from "@/lib/sync";

/**
 * React hook that subscribes to the SyncManager's state via useSyncExternalStore.
 * Re-renders the component whenever sync state, connection, or lastPushTime changes.
 */
export function useSyncStatus(): SyncStatus {
  const manager = SyncManager.getInstance();
  return useSyncExternalStore(
    (cb) => manager.subscribe(cb),
    () => manager.getSnapshot(),
  );
}
