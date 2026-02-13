import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import PreOrderFlow
from ..schemas import FlowCreate, FlowResponse, FlowUpdate

router = APIRouter()


@router.post(
    "/pre-orders/{pre_order_id}/flows", response_model=FlowResponse
)
async def create_flow(
    pre_order_id: uuid.UUID, body: FlowCreate, db: AsyncSession = Depends(get_db)
):
    flow = PreOrderFlow(
        pre_order_id=pre_order_id,
        product_id=body.product_id,
        quantity=body.quantity,
        price=body.price,
        unit_id=body.unit_id,
        comment=body.comment,
    )
    db.add(flow)
    await db.commit()
    await db.refresh(flow)
    # Re-fetch with relationships
    result = await db.execute(select(PreOrderFlow).where(PreOrderFlow.id == flow.id))
    fresh = result.scalar_one()
    return fresh


@router.put("/flows/{id}", response_model=FlowResponse)
async def update_flow(
    id: uuid.UUID, body: FlowUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(PreOrderFlow).where(PreOrderFlow.id == id))
    flow = result.scalar_one_or_none()
    if flow is None:
        raise HTTPException(status_code=404, detail="Flow not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(flow, key, value)

    await db.commit()
    await db.refresh(flow)
    # Re-fetch with relationships
    result = await db.execute(select(PreOrderFlow).where(PreOrderFlow.id == flow.id))
    fresh = result.scalar_one()
    return fresh


@router.delete("/flows/{id}")
async def delete_flow(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PreOrderFlow).where(PreOrderFlow.id == id))
    flow = result.scalar_one_or_none()
    if flow is None:
        raise HTTPException(status_code=404, detail="Flow not found")

    await db.delete(flow)
    await db.commit()
    return {"ok": True}
