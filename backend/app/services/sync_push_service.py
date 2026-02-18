import logging

from sqlalchemy.ext.asyncio import AsyncSession

from ..domain.repositories import IOperationLogRepository
from ..schemas import (
    EntityType,
    PushOperationRequest,
    PushOperationResult,
    PushResponse,
    PushResultStatus,
)
from .base_entity_sync_service import BaseEntitySyncService
from .event_broadcaster import SSEEvent, broadcaster

logger = logging.getLogger(__name__)


class SyncPushService:
    """Orchestrates batch processing of sync operations."""

    def __init__(
        self,
        session: AsyncSession,
        op_log_repo: IOperationLogRepository,
        sync_services: dict[EntityType, BaseEntitySyncService],
    ) -> None:
        self._session = session
        self._op_log_repo = op_log_repo
        self._sync_services = sync_services

    async def process_operations(
        self,
        operations: list[PushOperationRequest],
    ) -> PushResponse:
        """Process a batch of push operations, each in its own savepoint."""
        results: list[PushOperationResult] = []

        for op in operations:
            savepoint = await self._session.begin_nested()
            try:
                result = await self._dispatch(op)

                if result.status == PushResultStatus.SUCCESS:
                    await savepoint.commit()
                    # Broadcast SSE event after successful commit
                    if result.sync_id is not None:
                        await broadcaster.broadcast(
                            SSEEvent(
                                event="entity_changed",
                                entity_type=op.entity_type,
                                entity_id=str(op.entity_id),
                                sync_id=result.sync_id,
                            )
                        )
                else:
                    await savepoint.rollback()

                results.append(result)
            except Exception as exc:
                await savepoint.rollback()
                logger.exception("Error processing operation %s", op.id)
                results.append(
                    PushOperationResult(
                        operation_id=op.id,
                        status=PushResultStatus.ERROR,
                        message=str(exc),
                    )
                )

        await self._session.commit()
        return PushResponse(results=results)

    async def _dispatch(self, op: PushOperationRequest) -> PushOperationResult:
        """
        Dispatch operation to the appropriate entity sync service.

        Args:
            op: The operation to dispatch

        Returns:
            Result from the entity sync service, or error if entity type unknown
        """
        service = self._sync_services.get(op.entity_type)
        if service is None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.ERROR,
                message=f"Unsupported entity_type: {op.entity_type}",
            )

        return await service.handle(op)
