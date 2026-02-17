import uuid

from ..repositories.operation_log_repository import OperationLogRepository
from ..repositories.pre_order_repository import PreOrderRepository
from ..schemas import (
    EntityType,
    OperationType,
    PushOperationRequest,
    PushOperationResult,
    PushResultStatus,
    ResolvedFieldConflict,
)
from .conflict_resolver import ConflictResolver, parse_timestamp


class PreOrderSyncService:
    def __init__(
        self,
        pre_order_repo: PreOrderRepository,
        op_log_repo: OperationLogRepository,
        conflict_resolver: ConflictResolver,
    ) -> None:
        self._pre_order_repo = pre_order_repo
        self._op_log_repo = op_log_repo
        self._conflict_resolver = conflict_resolver

    async def handle(self, op: PushOperationRequest) -> PushOperationResult:
        if op.operation_type == OperationType.CREATE:
            return await self._create(op)
        if op.operation_type == OperationType.UPDATE:
            return await self._update(op)
        if op.operation_type == OperationType.DELETE:
            return await self._delete(op)

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.ERROR,
            message=f"Unknown operation_type: {op.operation_type}",
        )

    async def _create(self, op: PushOperationRequest) -> PushOperationResult:
        existing = await self._pre_order_repo.get_by_id(op.entity_id)
        if existing is not None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.SUCCESS,
                new_version=existing.version,
                message=f"PreOrder {op.entity_id} already exists, no-op",
            )

        pre_order = await self._pre_order_repo.create(
            entity_id=op.entity_id,
            partner_id=uuid.UUID(op.data["partner_id"]),
            delivery_date=op.data["delivery_date"],
            status=op.data.get("status", 0),
            order_date=op.data.get("order_date"),
            comment=op.data.get("comment"),
        )

        log_entry = await self._op_log_repo.record(
            entity_type=EntityType.PRE_ORDER,
            entity_id=pre_order.id,
            operation_type=OperationType.CREATE,
            data=PreOrderRepository.snapshot(pre_order),
        )

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.SUCCESS,
            sync_id=log_entry.sync_id,
            new_version=1,
        )

    async def _update(self, op: PushOperationRequest) -> PushOperationResult:
        pre_order = await self._pre_order_repo.get_by_id(op.entity_id)

        if pre_order is None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.ERROR,
                message=f"PreOrder {op.entity_id} not found",
            )

        # DELETE wins over UPDATE — already deleted, nothing to do
        if pre_order.deleted_at is not None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.SUCCESS,
                new_version=pre_order.version,
                message=f"PreOrder {op.entity_id} already deleted, no-op",
            )

        # Query which fields changed on the server since the client's version
        server_changed_fields: dict[str, str] = {}
        if op.expected_version is not None and op.expected_version != pre_order.version:
            server_changed_fields = await self._op_log_repo.get_server_changed_fields(
                entity_type=EntityType.PRE_ORDER,
                entity_id=op.entity_id,
                since_version=op.expected_version,
            )

        # Field-level merge with LWW per field
        resolution = self._conflict_resolver.resolve_update(
            server_state=PreOrderRepository.snapshot(pre_order),
            client_data=op.data,
            expected_version=op.expected_version,
            server_version=pre_order.version,
            client_timestamp=op.timestamp,
            server_changed_fields=server_changed_fields,
        )

        # Build conflict details for the response
        resolved_conflicts = [
            ResolvedFieldConflict(
                field=c.field,
                client_value=c.client_value,
                server_value=c.server_value,
                winner=c.winner,
            )
            for c in resolution.lww_resolved
        ] or None

        if not resolution.fields_to_apply:
            status = PushResultStatus.CONFLICT if resolved_conflicts else PushResultStatus.SUCCESS
            return PushOperationResult(
                operation_id=op.id,
                status=status,
                new_version=pre_order.version,
                message="All fields overridden by server"
                if resolved_conflicts
                else "No changes to apply, no-op",
                conflicts=resolved_conflicts,
            )

        pre_order = await self._pre_order_repo.apply_update(pre_order, resolution.fields_to_apply)

        log_entry = await self._op_log_repo.record(
            entity_type=EntityType.PRE_ORDER,
            entity_id=pre_order.id,
            operation_type=OperationType.UPDATE,
            data={**resolution.fields_to_apply, "version": pre_order.version},
        )

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.SUCCESS,
            sync_id=log_entry.sync_id,
            new_version=pre_order.version,
            conflicts=resolved_conflicts,
        )

    async def _delete(self, op: PushOperationRequest) -> PushOperationResult:
        pre_order = await self._pre_order_repo.get_by_id(op.entity_id)

        if pre_order is None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.ERROR,
                message=f"PreOrder {op.entity_id} not found",
            )

        # Already deleted — idempotent, nothing to do
        if pre_order.deleted_at is not None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.SUCCESS,
                new_version=pre_order.version,
                message=f"PreOrder {op.entity_id} already deleted, no-op",
            )

        # Version mismatch on DELETE — apply LWW: only reject if the server
        # was updated more recently than the client's delete request.
        if op.expected_version is not None and op.expected_version != pre_order.version:
            client_dt = parse_timestamp(op.timestamp)
            server_dt = parse_timestamp(
                pre_order.updated_at.isoformat() if pre_order.updated_at else op.timestamp,
            )
            if client_dt < server_dt:
                return PushOperationResult(
                    operation_id=op.id,
                    status=PushResultStatus.CONFLICT,
                    new_version=pre_order.version,
                    message=f"Delete rejected: entity was updated on server (version {pre_order.version}) after client delete request (expected version {op.expected_version})",
                )

        pre_order = await self._pre_order_repo.soft_delete(pre_order)

        log_entry = await self._op_log_repo.record(
            entity_type=EntityType.PRE_ORDER,
            entity_id=pre_order.id,
            operation_type=OperationType.DELETE,
            data=PreOrderRepository.snapshot(pre_order),
        )

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.SUCCESS,
            sync_id=log_entry.sync_id,
            new_version=pre_order.version,
        )
