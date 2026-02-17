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
        quantity: float,
        price: float,
        unit_id: uuid.UUID,
        comment: str | None = None,
    ) -> PreOrderFlow:
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
        flow: PreOrderFlow,
        data: dict,
    ) -> PreOrderFlow:
        """Apply partial field updates, bump version and updated_at."""
        updatable_fields = {"product_id", "quantity", "price", "unit_id", "comment"}
        for field, value in data.items():
            if field in updatable_fields:
                if field in ("product_id", "unit_id"):
                    value = uuid.UUID(value)
                setattr(flow, field, value)

        flow.version += 1
        flow.updated_at = datetime.now(UTC)
        await self._session.flush()
        return flow

    async def soft_delete(self, flow: PreOrderFlow) -> PreOrderFlow:
        """Soft-delete the flow."""
        now = datetime.now(UTC)

        flow.deleted_at = now
        flow.version += 1
        flow.updated_at = now
        await self._session.flush()
        return flow

    @staticmethod
    def snapshot(flow: PreOrderFlow) -> dict:
        """Build a JSON-serialisable snapshot for the operation_log data column."""
        return {
            "id": str(flow.id),
            "pre_order_id": str(flow.pre_order_id),
            "product_id": str(flow.product_id),
            "quantity": flow.quantity,
            "price": flow.price,
            "unit_id": str(flow.unit_id),
            "comment": flow.comment,
            "created_at": flow.created_at.isoformat() if flow.created_at else None,
            "updated_at": flow.updated_at.isoformat() if flow.updated_at else None,
            "version": flow.version,
        }
