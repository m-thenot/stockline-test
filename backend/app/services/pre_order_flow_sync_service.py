from typing import Any
from uuid import UUID

from ..domain.repositories import IOperationLogRepository
from ..models import PreOrderFlow
from ..repositories.pre_order_flow_repository import PreOrderFlowRepository
from ..schemas import EntityType
from .base_entity_sync_service import BaseEntitySyncService
from .conflict_resolver import ConflictResolver


class PreOrderFlowSyncService(BaseEntitySyncService[PreOrderFlow]):  # type: ignore[type-var]
    """
    Sync service for PreOrderFlow entities.

    Inherits all CREATE/UPDATE/DELETE logic from BaseEntitySyncService.
    Handles validation and type conversion for PreOrderFlow-specific fields.
    """

    def __init__(
        self,
        repo: PreOrderFlowRepository,
        op_log_repo: IOperationLogRepository,
        conflict_resolver: ConflictResolver,
    ) -> None:
        super().__init__(
            entity_type=EntityType.PRE_ORDER_FLOW,
            repo=repo,
            op_log_repo=op_log_repo,
            conflict_resolver=conflict_resolver,
            entity_name="PreOrderFlow",
        )
        self._pre_order_flow_repo = repo

    async def _create_entity(self, entity_id: UUID, data: dict[str, Any]) -> PreOrderFlow:
        """
        Create PreOrderFlow entity with validated data.

        Args:
            entity_id: The UUID for the new entity
            data: Raw dictionary from client

        Returns:
            The created PreOrderFlow entity

        Raises:
            ValueError, KeyError, TypeError: If validation fails
        """
        try:
            # Extract and validate required UUID fields
            pre_order_id = (
                UUID(data["pre_order_id"])
                if isinstance(data["pre_order_id"], str)
                else data["pre_order_id"]
            )
            product_id = (
                UUID(data["product_id"])
                if isinstance(data["product_id"], str)
                else data["product_id"]
            )
            unit_id = UUID(data["unit_id"]) if isinstance(data["unit_id"], str) else data["unit_id"]
            quantity: float = (
                float(data["quantity"]) if isinstance(data["quantity"], str) else data["quantity"]
            )
            price: float = float(data["price"]) if isinstance(data["price"], str) else data["price"]
            comment: str | None = data.get("comment")

            # Call repository with explicit typed parameters
            return await self._pre_order_flow_repo.create(
                entity_id=entity_id,
                pre_order_id=pre_order_id,
                product_id=product_id,
                unit_id=unit_id,
                quantity=quantity,
                price=price,
                comment=comment,
            )
        except KeyError as e:
            raise ValueError(f"Missing required field for PreOrderFlow: {e}") from e
        except (ValueError, TypeError) as e:
            raise ValueError(f"Invalid PreOrderFlow data: {e}") from e
