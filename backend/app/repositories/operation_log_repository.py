import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import OperationLog


class OperationLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def record(
        self,
        entity_type: str,
        entity_id: uuid.UUID,
        operation_type: str,
        data: dict,
    ) -> OperationLog:
        """Insert a row into operation_log and return it (sync_id populated after flush)."""
        entry = OperationLog(
            entity_type=entity_type,
            entity_id=entity_id,
            operation_type=operation_type,
            data=data,
            timestamp=datetime.now(UTC),
        )
        self._session.add(entry)
        await self._session.flush()
        return entry
