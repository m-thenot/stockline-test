import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import PreOrder
from ..schemas import PreOrderCreate, PreOrderResponse, PreOrderUpdate, RecapPartnerGroup

router = APIRouter(prefix="/pre-orders")


@router.get("/recap/{date}", response_model=list[RecapPartnerGroup])
async def get_recap(date: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PreOrder)
        .where(PreOrder.delivery_date == date, PreOrder.deleted_at.is_(None))
        .order_by(PreOrder.created_at)
    )
    pre_orders = result.scalars().all()

    # Group by partner
    groups: dict[str, RecapPartnerGroup] = {}
    for po in pre_orders:
        pid = str(po.partner_id)
        if pid not in groups:
            groups[pid] = RecapPartnerGroup(partner=po.partner, pre_orders=[])
        groups[pid].pre_orders.append(PreOrderResponse.model_validate(po))

    return list(groups.values())


@router.post("", response_model=PreOrderResponse)
async def create_pre_order(body: PreOrderCreate, db: AsyncSession = Depends(get_db)):
    pre_order = PreOrder(
        partner_id=body.partner_id,
        status=body.status,
        order_date=body.order_date,
        delivery_date=body.delivery_date,
        comment=body.comment,
    )
    db.add(pre_order)
    await db.commit()
    await db.refresh(pre_order)
    # Re-fetch with relationships
    result = await db.execute(select(PreOrder).where(PreOrder.id == pre_order.id))
    fresh = result.scalar_one()
    return fresh


@router.put("/{id}", response_model=PreOrderResponse)
async def update_pre_order(id: uuid.UUID, body: PreOrderUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PreOrder).where(PreOrder.id == id))
    pre_order = result.scalar_one_or_none()
    if pre_order is None:
        raise HTTPException(status_code=404, detail="Pre-order not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(pre_order, key, value)

    await db.commit()
    await db.refresh(pre_order)
    # Re-fetch with relationships
    result = await db.execute(select(PreOrder).where(PreOrder.id == pre_order.id))
    fresh = result.scalar_one()
    return fresh


@router.delete("/{id}")
async def delete_pre_order(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PreOrder).where(PreOrder.id == id))
    pre_order = result.scalar_one_or_none()
    if pre_order is None:
        raise HTTPException(status_code=404, detail="Pre-order not found")

    await db.delete(pre_order)
    await db.commit()
    return {"ok": True}
