import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import PreOrderFlow


class PreOrderFlowRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, entity_id: uuid.UUID) -> PreOrderFlow | None:
        return await self._session.get(PreOrderFlow, entity_id)

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
        """Create a new PreOrderFlow entity"""
        now = datetime.now(UTC)
        flow = PreOrderFlow(
            id=entity_id,
            pre_order_id=pre_order_id,
            product_id=product_id,
            quantity=quantity,
            price=price,
            unit_id=unit_id,
            comment=comment,
            created_at=now,
            updated_at=now,
            version=1,
        )
        self._session.add(flow)
        await self._session.flush()
        return flow

    async def apply_update(
        self,
        entity: PreOrderFlow,
        data: dict,
    ) -> PreOrderFlow:
        """Apply partial field updates, bump version and updated_at."""
        updatable_fields = {"product_id", "quantity", "price", "unit_id", "comment"}
        for field, value in data.items():
            if field in updatable_fields:
                if field in ("product_id", "unit_id"):
                    value = uuid.UUID(value)
                setattr(entity, field, value)

        entity.version += 1
        entity.updated_at = datetime.now(UTC)
        await self._session.flush()
        return entity

    async def soft_delete(self, entity: PreOrderFlow) -> PreOrderFlow:
        """Soft-delete the flow."""
        now = datetime.now(UTC)

        entity.deleted_at = now
        entity.version += 1
        entity.updated_at = now
        await self._session.flush()
        return entity
