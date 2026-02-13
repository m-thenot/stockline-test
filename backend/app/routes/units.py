from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Unit
from ..schemas import UnitResponse

router = APIRouter(prefix="/units")


@router.get("", response_model=list[UnitResponse])
async def list_units(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Unit))
    return result.scalars().all()
