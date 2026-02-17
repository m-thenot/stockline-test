import logging

from sqlalchemy.ext.asyncio import AsyncSession

from ..repositories.operation_log_repository import OperationLogRepository
from ..repositories.pre_order_flow_repository import PreOrderFlowRepository
from ..repositories.pre_order_repository import PreOrderRepository
from ..schemas import (
    EntityType,
    PushOperationRequest,
    PushOperationResult,
    PushResponse,
    PushResultStatus,
)
from .conflict_resolver import ConflictResolver
from .event_broadcaster import SSEEvent, broadcaster
from .pre_order_flow_sync_service import PreOrderFlowSyncService
from .pre_order_sync_service import PreOrderSyncService

logger = logging.getLogger(__name__)


class SyncPushService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        op_log_repo = OperationLogRepository(session)
        pre_order_repo = PreOrderRepository(session)
        pre_order_flow_repo = PreOrderFlowRepository(session)
        conflict_resolver = ConflictResolver()
        self._pre_order_sync = PreOrderSyncService(pre_order_repo, op_log_repo, conflict_resolver)
        self._pre_order_flow_sync = PreOrderFlowSyncService(
            pre_order_flow_repo, op_log_repo, conflict_resolver
        )

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
        if op.entity_type == EntityType.PRE_ORDER:
            return await self._pre_order_sync.handle(op)
        if op.entity_type == EntityType.PRE_ORDER_FLOW:
            return await self._pre_order_flow_sync.handle(op)

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.ERROR,
            message=f"Unsupported entity_type: {op.entity_type}",
        )
