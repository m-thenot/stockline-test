import type { SyncDB } from "./index";
import type { EntityType, OperationType } from "./models";
import { generateId } from "@/lib/utils/uuid";

/**
 * Base Repository class providing CRUD operations with automatic:
 * - ID generation (UUIDv7)
 * - Versioning (optimistic locking)
 * - Timestamps (created_at, updated_at)
 * - Outbox recording (for sync)
 *
 * @template T Entity type that must have id and version fields
 */
export abstract class Repository<
  T extends {
    id: string;
    version: number;
    created_at: string | null;
    updated_at: string | null;
  },
> {
  constructor(
    protected db: SyncDB,
    protected tableName: keyof SyncDB,
    protected entityType: EntityType,
  ) {}

  /**
   * Create a new entity
   * Automatically generates: id, version, created_at, updated_at
   * Records CREATE operation in outbox
   *
   * @param data Entity data (without id, version, timestamps)
   * @returns Created entity with all fields
   */
  async create(
    data: Omit<T, "id" | "version" | "created_at" | "updated_at">,
  ): Promise<T> {
    const now = new Date().toISOString();
    const entity: T = {
      ...data,
      id: generateId(),
      version: 1,
      created_at: now,
      updated_at: now,
    } as T;

    // Insert into table
    const table = this.db[this.tableName] as any;
    await table.add(entity);

    // Record in outbox
    await this.recordOperation(entity.id, "CREATE", entity);

    return entity;
  }

  /**
   * Update an existing entity
   * Automatically increments version and updates updated_at
   * Records UPDATE operation in outbox
   *
   * @param id Entity ID
   * @param data Partial entity data to update (cannot update id or version)
   * @returns Updated entity
   * @throws Error if entity not found
   */
  async update(
    id: string,
    data: Partial<Omit<T, "id" | "version">>,
  ): Promise<T> {
    // Fetch current entity
    const table = this.db[this.tableName] as any;
    const current = await table.get(id);

    if (!current) {
      throw new Error(`${this.entityType} with id ${id} not found`);
    }

    // Merge changes and increment version
    const now = new Date().toISOString();
    const updated: T = {
      ...current,
      ...data,
      id, // Ensure ID doesn't change
      version: current.version + 1,
      updated_at: now,
    };

    // Update in table
    await table.put(updated);

    // Record in outbox
    await this.recordOperation(id, "UPDATE", updated);

    return updated;
  }

  /**
   * Delete an entity
   * Records DELETE operation in outbox before removing from table
   *
   * @param id Entity ID
   * @throws Error if entity not found
   */
  async delete(id: string): Promise<void> {
    // Fetch current entity to get version
    const table = this.db[this.tableName] as any;
    const current = await table.get(id);

    if (!current) {
      throw new Error(`${this.entityType} with id ${id} not found`);
    }

    // Record in outbox BEFORE deleting (need version for conflict resolution)
    await this.recordOperation(id, "DELETE", { version: current.version });

    // Delete from table
    await table.delete(id);
  }

  /**
   * Get entity by ID
   *
   * @param id Entity ID
   * @returns Entity or undefined if not found
   */
  async getById(id: string): Promise<T | undefined> {
    const table = this.db[this.tableName] as any;
    return await table.get(id);
  }

  /**
   * Get all entities
   *
   * @returns Array of all entities
   */
  async getAll(): Promise<T[]> {
    const table = this.db[this.tableName] as any;
    return await table.toArray();
  }

  /**
   * Record an operation in the outbox for sync
   * Uses the helper method from SyncDB for sequence number generation
   *
   * @param entityId Entity ID
   * @param operation Operation type (CREATE, UPDATE, DELETE)
   * @param data Entity data or version info
   */
  private async recordOperation(
    entityId: string,
    operation: OperationType,
    data: unknown,
  ): Promise<void> {
    await this.db.addOutboxOperation({
      id: generateId(),
      entity_type: this.entityType,
      entity_id: entityId,
      operation_type: operation,
      data,
      timestamp: new Date().toISOString(),
      status: "pending",
      retry_count: 0,
    });
  }
}
