import { formatDistanceToNow } from "date-fns";
import type { ConnectionState } from "@/lib/sync/types";

/**
 * Get the display label for last sync time based on connection state
 * Shows relative time ("2 hours ago") when offline/unknown and timestamp exists
 */
export function getLastSyncLabel(
  lastSyncTimestamp: number | null,
  connection: ConnectionState,
): string | null {
  if (
    (connection === "offline" || connection === "unknown") &&
    lastSyncTimestamp
  ) {
    const date = new Date(lastSyncTimestamp);
    return formatDistanceToNow(date, { addSuffix: true });
  }
  return null;
}
