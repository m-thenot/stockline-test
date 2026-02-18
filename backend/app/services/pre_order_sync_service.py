from typing import Any
from uuid import UUID

from ..domain.repositories import IOperationLogRepository
from ..models import PreOrder
from ..repositories.pre_order_repository import PreOrderRepository
from ..schemas import EntityType
from .base_entity_sync_service import BaseEntitySyncService
from .conflict_resolver import ConflictResolver


class PreOrderSyncService(BaseEntitySyncService[PreOrder]):  # type: ignore[type-var]
    """
    Sync service for PreOrder entities.

    Inherits all CREATE/UPDATE/DELETE logic from BaseEntitySyncService.
    Handles validation and type conversion for PreOrder-specific fields.
    """

    def __init__(
        self,
        repo: PreOrderRepository,
        op_log_repo: IOperationLogRepository,
        conflict_resolver: ConflictResolver,
    ) -> None:
        super().__init__(
            entity_type=EntityType.PRE_ORDER,
            repo=repo,
            op_log_repo=op_log_repo,
            conflict_resolver=conflict_resolver,
            entity_name="PreOrder",
        )
        self._pre_order_repo = repo

    async def _create_entity(self, entity_id: UUID, data: dict[str, Any]) -> PreOrder:
        """
        Create PreOrder entity with validated data.

        Args:
            entity_id: The UUID for the new entity
            data: Raw dictionary from client

        Returns:
            The created PreOrder entity

        Raises:
            ValueError, KeyError, TypeError: If validation fails
        """
        try:
            # Extract and validate required fields
            partner_id = (
                UUID(data["partner_id"])
                if isinstance(data["partner_id"], str)
                else data["partner_id"]
            )
            delivery_date: str = data["delivery_date"]

            # Extract optional fields with defaults
            status: int = int(data.get("status", 0))
            order_date: str | None = data.get("order_date")
            comment: str | None = data.get("comment")

            # Call repository with explicit typed parameters
            return await self._pre_order_repo.create(
                entity_id=entity_id,
                partner_id=partner_id,
                delivery_date=delivery_date,
                status=status,
                order_date=order_date,
                comment=comment,
            )
        except KeyError as e:
            raise ValueError(f"Missing required field for PreOrder: {e}") from e
        except (ValueError, TypeError) as e:
            raise ValueError(f"Invalid PreOrder data: {e}") from e
