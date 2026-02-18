from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol, TypeVar
from uuid import UUID


class EntityProtocol(Protocol):
    """
    Protocol defining common attributes that all syncable entities must have.

    This protocol ensures that entity models have the required fields for
    the sync system to function properly.
    """

    id: UUID
    version: int
    created_at: datetime | None
    updated_at: datetime | None
    deleted_at: datetime | None


# Entity type variable for generic repository
T = TypeVar("T", bound=EntityProtocol)


class IEntityRepository(Protocol[T]):
    """
    Protocol for entity repositories.
    Allows mocking and dependency injection.

    This protocol defines the interface that all entity repositories must implement.
    Services depend on this protocol rather than concrete repository implementations,
    following the Dependency Inversion Principle.
    """

    async def get_by_id(self, entity_id: UUID) -> T | None:
        """
        Fetch entity by ID.

        Returns:
            The entity if found and not soft-deleted, None otherwise.
        """
        ...

    async def apply_update(self, entity: T, data: dict[str, Any]) -> T:
        """
        Apply partial update to entity.

        Only updates whitelisted fields defined by the repository.
        Automatically bumps version and updated_at timestamp.

        Args:
            entity: The entity to update
            data: Dictionary of fields to update (only whitelisted fields applied)

        Returns:
            The updated entity with incremented version
        """
        ...

    async def soft_delete(self, entity: T) -> T:
        """
        Soft-delete entity (sets deleted_at timestamp).

        Automatically bumps version and updated_at timestamp.

        Args:
            entity: The entity to soft-delete

        Returns:
            The soft-deleted entity with incremented version
        """
        ...


class IOperationLogRepository(Protocol):
    """
    Protocol for operation log repository.

    The operation log tracks all CREATE/UPDATE/DELETE operations for sync purposes.
    Each operation gets a monotonically increasing sync_id.
    """

    async def record(
        self,
        entity_type: str,
        entity_id: UUID,
        operation_type: str,
        data: dict[str, Any],
    ) -> Any:
        """
        Record an operation in the operation log.

        Args:
            entity_type: The type of entity (e.g., "PRE_ORDER")
            entity_id: The UUID of the affected entity
            operation_type: The operation type ("CREATE", "UPDATE", or "DELETE")
            data: Snapshot of the entity after the operation

        Returns:
            The created OperationLog entry (with sync_id populated)
        """
        ...

    async def get_server_changed_fields(
        self,
        entity_type: str,
        entity_id: UUID,
        since_version: int,
    ) -> dict[str, str]:
        """
        Get fields changed on server since given version.

        Used for conflict detection during UPDATE operations.
        Returns a mapping of field names to the ISO timestamp when they were last changed.

        Args:
            entity_type: The type of entity
            entity_id: The UUID of the entity
            since_version: The version to check changes since

        Returns:
            Dictionary mapping field names to ISO timestamp strings
        """
        ...
