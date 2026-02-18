from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.models import OperationLog, PreOrder, PreOrderFlow


class FakePreOrderRepository:
    """In-memory fake repository for PreOrder entities."""

    def __init__(self) -> None:
        self._storage: dict[uuid.UUID, PreOrder] = {}

    async def get_by_id(self, entity_id: uuid.UUID) -> PreOrder | None:
        """Get entity by ID, returning None if not found."""
        # Return entity even if deleted_at is set, so base service can check it
        return self._storage.get(entity_id)

    async def create(
        self,
        entity_id: uuid.UUID,
        partner_id: uuid.UUID,
        delivery_date: str,
        status: int = 0,
        order_date: str | None = None,
        comment: str | None = None,
    ) -> PreOrder:
        """Create a new PreOrder entity."""
        now = datetime.now(UTC)
        pre_order = PreOrder(
            id=entity_id,
            partner_id=partner_id,
            status=status,
            order_date=order_date,
            delivery_date=delivery_date,
            comment=comment,
            created_at=now,
            updated_at=now,
            version=1,
            deleted_at=None,
        )
        self._storage[entity_id] = pre_order
        return pre_order

    async def apply_update(self, entity: PreOrder, data: dict[str, Any]) -> PreOrder:
        """Apply partial field updates, bump version and updated_at."""
        updatable_fields = {"partner_id", "status", "order_date", "delivery_date", "comment"}
        for field, value in data.items():
            if field in updatable_fields:
                if field == "partner_id":
                    value = uuid.UUID(value) if isinstance(value, str) else value
                setattr(entity, field, value)

        entity.version += 1
        entity.updated_at = datetime.now(UTC)
        return entity

    async def soft_delete(self, entity: PreOrder) -> PreOrder:
        """Soft-delete the entity."""
        now = datetime.now(UTC)
        entity.deleted_at = now
        entity.version += 1
        entity.updated_at = now
        return entity


class FakeOperationLogRepository:
    """In-memory fake repository for OperationLog entries."""

    def __init__(self) -> None:
        self._storage: list[OperationLog] = []
        self._sync_id_counter = 0

    async def record(
        self,
        entity_type: str,
        entity_id: uuid.UUID,
        operation_type: str,
        data: dict[str, Any],
        timestamp: datetime | None = None,
    ) -> OperationLog:
        """Record an operation in the operation log."""
        self._sync_id_counter += 1
        entry = OperationLog(
            sync_id=self._sync_id_counter,
            entity_type=entity_type,
            entity_id=entity_id,
            operation_type=operation_type,
            data=data,
            timestamp=timestamp or datetime.now(UTC),
        )
        self._storage.append(entry)
        return entry

    async def get_server_changed_fields(
        self,
        entity_type: str,
        entity_id: uuid.UUID,
        since_version: int,
    ) -> dict[str, str]:
        """Get fields changed on server since given version."""
        changed_fields: dict[str, str] = {}
        for log in self._storage:
            if (
                log.entity_type == entity_type
                and log.entity_id == entity_id
                and log.operation_type == "UPDATE"
            ):
                log_version = log.data.get("version") if log.data else None
                if log_version is not None and log_version > since_version:
                    ts = log.timestamp.isoformat() if log.timestamp else ""
                    for key in log.data:
                        if key != "version":
                            changed_fields[key] = ts
        return changed_fields


class FakePreOrderFlowRepository:
    """In-memory fake repository for PreOrderFlow entities."""

    def __init__(self) -> None:
        self._storage: dict[uuid.UUID, PreOrderFlow] = {}

    async def get_by_id(self, entity_id: uuid.UUID) -> PreOrderFlow | None:
        """Get entity by ID, returning None if not found."""
        # Return entity even if deleted_at is set, so base service can check it
        return self._storage.get(entity_id)

    async def create(
        self,
        entity_id: uuid.UUID,
        pre_order_id: uuid.UUID,
        product_id: uuid.UUID,
        unit_id: uuid.UUID,
        quantity: float,
        price: float,
        comment: str | None = None,
    ) -> PreOrderFlow:
        """Create a new PreOrderFlow entity."""
        now = datetime.now(UTC)
        flow = PreOrderFlow(
            id=entity_id,
            pre_order_id=pre_order_id,
            product_id=product_id,
            unit_id=unit_id,
            quantity=quantity,
            price=price,
            comment=comment,
            created_at=now,
            updated_at=now,
            version=1,
            deleted_at=None,
        )
        self._storage[entity_id] = flow
        return flow

    async def apply_update(self, entity: PreOrderFlow, data: dict[str, Any]) -> PreOrderFlow:
        """Apply partial field updates, bump version and updated_at."""
        updatable_fields = {"product_id", "quantity", "price", "unit_id", "comment"}
        for field, value in data.items():
            if field in updatable_fields:
                if field in ("product_id", "unit_id"):
                    value = uuid.UUID(value) if isinstance(value, str) else value
                setattr(entity, field, value)

        entity.version += 1
        entity.updated_at = datetime.now(UTC)
        return entity

    async def soft_delete(self, entity: PreOrderFlow) -> PreOrderFlow:
        """Soft-delete the entity."""
        now = datetime.now(UTC)
        entity.deleted_at = now
        entity.version += 1
        entity.updated_at = now
        return entity
