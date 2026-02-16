import asyncio

from fastapi import APIRouter
from sqlalchemy import select

from ..database import AsyncSessionLocal
from ..models import Partner, PreOrder, PreOrderFlow, Product, Unit
from ..schemas import (
    FlowSnapshotResponse,
    PartnerResponse,
    PreOrderSnapshotResponse,
    ProductResponse,
    UnitResponse,
)

router = APIRouter(prefix="/sync")


async def _fetch_all(stmt):
    async with AsyncSessionLocal() as session:
        result = await session.execute(stmt)
        return result.scalars().all()


# TODO: Replace full snapshot with pagination or streaming (SSE)
# to avoid large payloads and improve scalability. + only last 2 weeks of data
@router.get("/snapshot")
async def get_snapshot():
    """
    Return a full snapshot of all data
    """
    partners, products, units, pre_orders, flows = await asyncio.gather(
        _fetch_all(select(Partner)),
        _fetch_all(select(Product)),
        _fetch_all(select(Unit)),
        _fetch_all(select(PreOrder)),
        _fetch_all(select(PreOrderFlow)),
    )

    return {
        "partners": [PartnerResponse.model_validate(p).model_dump(mode="json") for p in partners],
        "products": [ProductResponse.model_validate(p).model_dump(mode="json") for p in products],
        "units": [UnitResponse.model_validate(u).model_dump(mode="json") for u in units],
        "pre_orders": [
            PreOrderSnapshotResponse.model_validate(po).model_dump(mode="json") for po in pre_orders
        ],
        "flows": [FlowSnapshotResponse.model_validate(f).model_dump(mode="json") for f in flows],
    }
