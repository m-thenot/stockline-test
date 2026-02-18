from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from .repositories.operation_log_repository import OperationLogRepository
from .repositories.pre_order_flow_repository import PreOrderFlowRepository
from .repositories.pre_order_repository import PreOrderRepository
from .schemas import EntityType
from .services.base_entity_sync_service import BaseEntitySyncService
from .services.conflict_resolver import ConflictResolver
from .services.pre_order_flow_sync_service import PreOrderFlowSyncService
from .services.pre_order_sync_service import PreOrderSyncService
from .services.sync_push_service import SyncPushService


class DependencyContainer:
    """
    Dependency injection container.

    Creates and wires all dependencies for sync services following
    the Dependency Inversion Principle.

    Validation is handled by individual repositories, not a centralized registry.
    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize the container with a database session.

        Args:
            session: SQLAlchemy async session for database access
        """
        self.session = session

        # Create repositories (Infrastructure layer)
        self.pre_order_repo = PreOrderRepository(session)
        self.pre_order_flow_repo = PreOrderFlowRepository(session)
        self.op_log_repo = OperationLogRepository(session)

        # Create shared services
        self.conflict_resolver = ConflictResolver()

        # Create entity sync services (Domain layer)
        self.pre_order_sync = PreOrderSyncService(
            repo=self.pre_order_repo,
            op_log_repo=self.op_log_repo,
            conflict_resolver=self.conflict_resolver,
        )

        self.pre_order_flow_sync = PreOrderFlowSyncService(
            repo=self.pre_order_flow_repo,
            op_log_repo=self.op_log_repo,
            conflict_resolver=self.conflict_resolver,
        )

        # Map entity types to sync services for dispatcher
        self.sync_services: dict[EntityType, BaseEntitySyncService] = {
            EntityType.PRE_ORDER: self.pre_order_sync,
            EntityType.PRE_ORDER_FLOW: self.pre_order_flow_sync,
        }

    def get_sync_push_service(self) -> SyncPushService:
        """
        Create SyncPushService with all dependencies wired.

        Returns:
            Fully configured SyncPushService ready to process operations
        """
        return SyncPushService(
            session=self.session,
            op_log_repo=self.op_log_repo,
            sync_services=self.sync_services,
        )
