import { useSyncExternalStore } from "react";
import { SyncManager } from "@/lib/sync";
import type { SyncStatus } from "@/lib/sync";

const serverSnapshot: SyncStatus = {
  state: "idle",
  connection: "unknown",
  lastPushTime: null,
  lastError: null,
  pendingOperations: 0,
  pullSyncing: false,
};

/**
 * React hook that subscribes to the SyncManager's state via useSyncExternalStore.
 * Re-renders the component whenever sync state, connection, or lastPushTime changes.
 */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => SyncManager.getInstance().subscribe(cb),
    () => SyncManager.getInstance().getSnapshot(),
    () => serverSnapshot,
  );
}
