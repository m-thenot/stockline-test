import asyncio
import json
import uuid as uuid_mod
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import AsyncSessionLocal, get_db
from ..models import OperationLog, Partner, PreOrder, PreOrderFlow, Product, Unit
from ..schemas import (
    FlowSnapshotResponse,
    PartnerResponse,
    PreOrderSnapshotResponse,
    ProductResponse,
    PullOperationResponse,
    PullResponse,
    PushRequest,
    PushResponse,
    UnitResponse,
)
from ..services.event_broadcaster import broadcaster
from ..services.sync_push_service import SyncPushService

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
        _fetch_all(select(PreOrder).where(PreOrder.deleted_at.is_(None))),
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


@router.post("/push", response_model=PushResponse)
async def push_operations(body: PushRequest, db: AsyncSession = Depends(get_db)):
    """
    Receive a batch of operations from the client and apply them.
    Each operation is processed in its own savepoint so that individual
    failures do not roll back the entire batch.
    """
    service = SyncPushService(db)
    return await service.process_operations(body.operations)


@router.get("/events")
async def sse_events(request: Request):
    """
    SSE endpoint for real-time change notifications.
    Maintains a persistent HTTP connection and streams events when entities change.
    """
    client_id = str(uuid_mod.uuid4())
    queue = await broadcaster.connect(client_id)

    async def event_generator():
        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break

                event = await queue.get()
                if event is None:
                    break

                data = json.dumps(
                    {
                        "event": event.event,
                        "entity_type": event.entity_type,
                        "entity_id": event.entity_id,
                        "sync_id": event.sync_id,
                    }
                )
                yield f"data: {data}\n\n"
        finally:
            broadcaster.disconnect(client_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/pull", response_model=PullResponse)
async def pull_operations(
    since_sync_id: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """
    Pull incremental operations from the operation_log since a given sync_id.
    Used by clients to fetch changes after receiving SSE notifications.
    """
    # Query operation_log for changes since the client's last sync point
    stmt = (
        select(OperationLog)
        .where(OperationLog.sync_id > since_sync_id)
        .order_by(OperationLog.sync_id)
        .limit(limit + 1)  # fetch one extra to determine has_more
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    has_more = len(rows) > limit
    operations = rows[:limit]

    return PullResponse(
        operations=[
            PullOperationResponse(
                sync_id=op.sync_id,
                entity_type=op.entity_type,
                entity_id=op.entity_id,
                operation_type=op.operation_type,
                data=op.data,
                timestamp=op.timestamp or datetime.now(UTC),
            )
            for op in operations
        ],
        has_more=has_more,
    )
