from __future__ import annotations

from datetime import datetime
from typing import Any, Generic
from uuid import UUID

from sqlalchemy import inspect as sa_inspect

from ..domain.repositories import IEntityRepository, IOperationLogRepository, T
from ..schemas import (
    EntityType,
    OperationType,
    PushOperationRequest,
    PushOperationResult,
    PushResultStatus,
    ResolvedFieldConflict,
)
from .conflict_resolver import ConflictResolver, parse_timestamp


class BaseEntitySyncService(Generic[T]):
    """
    Base class for entity sync services.

    Provides generic implementation for CREATE, UPDATE, and DELETE operations
    using repository protocols for dependency inversion.

    Type Parameters:
        T: The entity model type (e.g., PreOrder, PreOrderFlow)
    """

    def __init__(
        self,
        entity_type: EntityType,
        repo: IEntityRepository[T],
        op_log_repo: IOperationLogRepository,
        conflict_resolver: ConflictResolver,
        entity_name: str | None = None,
    ) -> None:
        self._entity_type = entity_type
        self._repo = repo
        self._op_log_repo = op_log_repo
        self._conflict_resolver = conflict_resolver
        self._entity_name = entity_name or entity_type.value

    async def handle(self, op: PushOperationRequest) -> PushOperationResult:
        """
        Dispatch operation to appropriate handler.

        Args:
            op: The operation to process

        Returns:
            Result of the operation
        """
        if op.operation_type == OperationType.CREATE:
            return await self._create(op)
        if op.operation_type == OperationType.UPDATE:
            return await self._update(op)
        if op.operation_type == OperationType.DELETE:
            return await self._delete(op)

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.ERROR,
            message=f"Unknown operation_type: {op.operation_type}",
        )

    async def _create(self, op: PushOperationRequest) -> PushOperationResult:
        """
        Generic CREATE handler.

        Handles idempotency, delegates entity creation, handles logging.
        """
        # Idempotency check: if entity already exists, return success
        existing = await self._repo.get_by_id(op.entity_id)
        if existing is not None:
            snapshot = self._snapshot_entity(existing)
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.SUCCESS,
                new_version=snapshot.get("version"),
                message=f"{self._entity_name} {op.entity_id} already exists (idempotent)",
            )

        # Delegate entity creation to subclass
        try:
            entity = await self._create_entity(op.entity_id, op.data)
        except (ValueError, KeyError, TypeError) as e:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.ERROR,
                message=f"Validation error: {e}",
            )

        # Record in operation log
        log_entry = await self._op_log_repo.record(
            entity_type=self._entity_type.value,
            entity_id=op.entity_id,
            operation_type=OperationType.CREATE,
            data=self._snapshot_entity(entity),
        )

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.SUCCESS,
            sync_id=log_entry.sync_id,
            new_version=1,
        )

    async def _create_entity(self, entity_id: Any, data: dict[str, Any]) -> T:
        """
        Hook method for creating entity with typed parameters.

        Args:
            entity_id: The UUID for the new entity
            data: Raw dictionary from PushOperationRequest.data

        Returns:
            The created entity

        Raises:
            ValueError, KeyError, TypeError: If validation fails
        """
        raise NotImplementedError(f"{self.__class__.__name__} must implement _create_entity()")

    async def _update(self, op: PushOperationRequest) -> PushOperationResult:
        """
        Generic UPDATE handler.

        Args:
            op: The UPDATE operation request

        Returns:
            Result with conflict information if applicable
        """
        entity = await self._repo.get_by_id(op.entity_id)

        if entity is None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.ERROR,
                message=f"{self._entity_name} {op.entity_id} not found",
            )

        # Check if entity is already deleted (idempotency)
        if hasattr(entity, "deleted_at") and entity.deleted_at is not None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.SUCCESS,
                new_version=entity.version,
                message=f"{self._entity_name} {op.entity_id} already deleted, no-op",
            )

        # Get server-changed fields for conflict detection
        server_changed_fields: dict[str, str] = {}
        entity_version = entity.version
        if op.expected_version is not None and op.expected_version != entity_version:
            server_changed_fields = await self._op_log_repo.get_server_changed_fields(
                entity_type=self._entity_type.value,
                entity_id=op.entity_id,
                since_version=op.expected_version,
            )

        # Resolve conflicts using ConflictResolver
        resolution = self._conflict_resolver.resolve_update(
            server_state=self._snapshot_entity(entity),
            client_data=op.data,
            expected_version=op.expected_version,
            server_version=entity_version,
            client_timestamp=op.timestamp,
            server_changed_fields=server_changed_fields,
        )

        # Convert internal conflict format to API format
        resolved_conflicts = [
            ResolvedFieldConflict(
                field=c.field,
                client_value=c.client_value,
                server_value=c.server_value,
                winner=c.winner,
            )
            for c in resolution.lww_resolved
        ] or None

        # If no fields to apply, return early
        if not resolution.fields_to_apply:
            status = PushResultStatus.CONFLICT if resolved_conflicts else PushResultStatus.SUCCESS
            return PushOperationResult(
                operation_id=op.id,
                status=status,
                new_version=entity_version,
                message=(
                    "All fields overridden by server"
                    if resolved_conflicts
                    else "No changes to apply, no-op"
                ),
                conflicts=resolved_conflicts,
            )

        # Apply updates via repository
        entity = await self._repo.apply_update(entity, resolution.fields_to_apply)

        # Record in operation log
        log_entry = await self._op_log_repo.record(
            entity_type=self._entity_type.value,
            entity_id=entity.id,
            operation_type=OperationType.UPDATE,
            data={**resolution.fields_to_apply, "version": entity.version},
        )

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.SUCCESS,
            sync_id=log_entry.sync_id,
            new_version=entity.version,
            conflicts=resolved_conflicts,
        )

    async def _delete(self, op: PushOperationRequest) -> PushOperationResult:
        """
        Generic DELETE handler.

        Args:
            op: The DELETE operation request

        Returns:
            Result with conflict information if version mismatch detected
        """
        entity = await self._repo.get_by_id(op.entity_id)

        if entity is None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.ERROR,
                message=f"{self._entity_name} {op.entity_id} not found",
            )

        # Check if entity is already deleted (idempotency)
        if hasattr(entity, "deleted_at") and entity.deleted_at is not None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.SUCCESS,
                new_version=entity.version,
                message=f"{self._entity_name} {op.entity_id} already deleted, no-op",
            )

        # Check for version mismatch (conflict)
        entity_version = entity.version
        if op.expected_version is not None and op.expected_version != entity_version:
            client_dt = parse_timestamp(op.timestamp)
            entity_updated_at = entity.updated_at if hasattr(entity, "updated_at") else None
            server_dt = parse_timestamp(
                entity_updated_at.isoformat() if entity_updated_at else op.timestamp,
            )
            if client_dt < server_dt:
                return PushOperationResult(
                    operation_id=op.id,
                    status=PushResultStatus.CONFLICT,
                    new_version=entity_version,
                    message=(
                        f"Delete rejected: entity was updated on server (version {entity_version}) "
                        f"after client delete request (expected version {op.expected_version})"
                    ),
                )

        # Soft-delete via repository
        entity = await self._repo.soft_delete(entity)

        # Record in operation log
        log_entry = await self._op_log_repo.record(
            entity_type=self._entity_type.value,
            entity_id=entity.id,
            operation_type=OperationType.DELETE,
            data=self._snapshot_entity(entity),
        )

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.SUCCESS,
            sync_id=log_entry.sync_id,
            new_version=entity.version,
        )

    def _snapshot_entity(self, entity: T) -> dict[str, Any]:
        """
        Create JSON-serializable snapshot using SQLAlchemy inspection.

        Automatically handles:
        - UUID → string conversion
        - datetime → ISO format string conversion

        Args:
            entity: The entity to snapshot

        Returns:
            JSON-serializable dictionary of entity column values
        """
        inspector = sa_inspect(entity)
        assert inspector is not None, "Entity must be a SQLAlchemy ORM instance"
        snapshot = {}

        for attr in inspector.mapper.column_attrs:
            value = getattr(entity, attr.key)

            # Convert UUIDs to strings
            if isinstance(value, UUID):
                snapshot[attr.key] = str(value)
            # Convert datetimes to ISO format
            elif isinstance(value, datetime):
                snapshot[attr.key] = value.isoformat()
            # Handle None and other types (int, float, str, bool)
            else:
                snapshot[attr.key] = value

        return snapshot
