from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Partner
from ..schemas import PartnerResponse

router = APIRouter(prefix="/partners")


@router.get("", response_model=list[PartnerResponse])
async def list_partners(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Partner))
    return result.scalars().all()
