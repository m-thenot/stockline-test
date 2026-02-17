import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, select
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

    async def get_server_changed_fields(
        self,
        entity_type: str,
        entity_id: uuid.UUID,
        since_version: int,
    ) -> dict[str, str]:
        """Return {field_name: timestamp_iso} for fields changed since since_version.

        Queries UPDATE entries in the operation_log for this entity whose
        stored version (in data->'version') is greater than since_version.
        Each entry's data keys are the fields that were changed, and the
        entry's timestamp tells us when.
        """
        result = await self._session.execute(
            select(OperationLog)
            .where(
                and_(
                    OperationLog.entity_type == entity_type,
                    OperationLog.entity_id == entity_id,
                    OperationLog.operation_type == "UPDATE",
                )
            )
            .order_by(OperationLog.sync_id.asc())
        )
        logs = result.scalars().all()

        changed_fields: dict[str, str] = {}
        for log in logs:
            log_version = log.data.get("version") if log.data else None
            if log_version is not None and log_version > since_version:
                ts = log.timestamp.isoformat() if log.timestamp else ""
                for key in log.data:
                    if key != "version":
                        changed_fields[key] = ts

        return changed_fields
