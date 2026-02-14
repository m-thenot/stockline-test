import { uuidv7 } from "uuidv7";

/**
 * Generate a UUIDv7 (time-ordered UUID)
 * Contains timestamp in first 48 bits for sortability
 *
 * Benefits:
 * - Sortable: IDs are chronologically ordered
 * - Performance: Better B-tree index performance than UUIDv4
 * - Compatible: Same format as UUIDv4 (36 characters)
 */
export function generateId(): string {
  return uuidv7();
}
