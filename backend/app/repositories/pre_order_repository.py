import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import PreOrder, PreOrderFlow


class PreOrderRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, entity_id: uuid.UUID) -> PreOrder | None:
        return await self._session.get(PreOrder, entity_id)

    async def create(
        self,
        entity_id: uuid.UUID,
        partner_id: uuid.UUID,
        delivery_date: str,
        status: int = 0,
        order_date: str | None = None,
        comment: str | None = None,
    ) -> PreOrder:
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
        )
        self._session.add(pre_order)
        await self._session.flush()
        return pre_order

    async def apply_update(
        self,
        pre_order: PreOrder,
        data: dict,
    ) -> PreOrder:
        """Apply partial field updates, bump version and updated_at."""
        updatable_fields = {"partner_id", "status", "order_date", "delivery_date", "comment"}
        for field, value in data.items():
            if field in updatable_fields:
                if field == "partner_id":
                    value = uuid.UUID(value)
                setattr(pre_order, field, value)

        pre_order.version += 1
        pre_order.updated_at = datetime.now(UTC)
        await self._session.flush()
        return pre_order

    async def soft_delete(self, pre_order: PreOrder) -> PreOrder:
        """Soft-delete the pre_order and hard-delete its associated flows."""
        now = datetime.now(UTC)

        flows_result = await self._session.execute(
            select(PreOrderFlow).where(PreOrderFlow.pre_order_id == pre_order.id)
        )
        for flow in flows_result.scalars().all():
            await self._session.delete(flow)

        pre_order.deleted_at = now
        pre_order.version += 1
        pre_order.updated_at = now
        await self._session.flush()
        return pre_order

    @staticmethod
    def snapshot(po: PreOrder) -> dict:
        """Build a JSON-serialisable snapshot for the operation_log data column."""
        return {
            "id": str(po.id),
            "partner_id": str(po.partner_id),
            "status": po.status,
            "order_date": po.order_date,
            "delivery_date": po.delivery_date,
            "comment": po.comment,
            "created_at": po.created_at.isoformat() if po.created_at else None,
            "updated_at": po.updated_at.isoformat() if po.updated_at else None,
            "version": po.version,
        }
