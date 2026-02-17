import uuid

from ..repositories.operation_log_repository import OperationLogRepository
from ..repositories.pre_order_flow_repository import PreOrderFlowRepository
from ..schemas import (
    EntityType,
    OperationType,
    PushOperationRequest,
    PushOperationResult,
    PushResultStatus,
    ResolvedFieldConflict,
)
from .conflict_resolver import ConflictResolver, parse_timestamp


class PreOrderFlowSyncService:
    def __init__(
        self,
        pre_order_flow_repo: PreOrderFlowRepository,
        op_log_repo: OperationLogRepository,
        conflict_resolver: ConflictResolver,
    ) -> None:
        self._pre_order_flow_repo = pre_order_flow_repo
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
        existing = await self._pre_order_flow_repo.get_by_id(op.entity_id)
        if existing is not None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.SUCCESS,
                new_version=existing.version,
                message=f"PreOrderFlow {op.entity_id} already exists, no-op",
            )

        flow = await self._pre_order_flow_repo.create(
            entity_id=op.entity_id,
            pre_order_id=uuid.UUID(op.data["pre_order_id"]),
            product_id=uuid.UUID(op.data["product_id"]),
            quantity=op.data.get("quantity", 0.0),
            price=op.data.get("price", 0.0),
            unit_id=uuid.UUID(op.data["unit_id"]),
            comment=op.data.get("comment"),
        )

        log_entry = await self._op_log_repo.record(
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=flow.id,
            operation_type=OperationType.CREATE,
            data=PreOrderFlowRepository.snapshot(flow),
        )

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.SUCCESS,
            sync_id=log_entry.sync_id,
            new_version=1,
        )

    async def _update(self, op: PushOperationRequest) -> PushOperationResult:
        flow = await self._pre_order_flow_repo.get_by_id(op.entity_id)

        if flow is None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.ERROR,
                message=f"PreOrderFlow {op.entity_id} not found",
            )

        # DELETE wins over UPDATE — already deleted, nothing to do
        if flow.deleted_at is not None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.SUCCESS,
                new_version=flow.version,
                message=f"PreOrderFlow {op.entity_id} already deleted, no-op",
            )

        # Query which fields changed on the server since the client's version
        server_changed_fields: dict[str, str] = {}
        if op.expected_version is not None and op.expected_version != flow.version:
            server_changed_fields = await self._op_log_repo.get_server_changed_fields(
                entity_type=EntityType.PRE_ORDER_FLOW,
                entity_id=op.entity_id,
                since_version=op.expected_version,
            )

        # Field-level merge with LWW per field
        resolution = self._conflict_resolver.resolve_update(
            server_state=PreOrderFlowRepository.snapshot(flow),
            client_data=op.data,
            expected_version=op.expected_version,
            server_version=flow.version,
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
                new_version=flow.version,
                message="All fields overridden by server"
                if resolved_conflicts
                else "No changes to apply, no-op",
                conflicts=resolved_conflicts,
            )

        flow = await self._pre_order_flow_repo.apply_update(flow, resolution.fields_to_apply)

        log_entry = await self._op_log_repo.record(
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=flow.id,
            operation_type=OperationType.UPDATE,
            data={**resolution.fields_to_apply, "version": flow.version},
        )

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.SUCCESS,
            sync_id=log_entry.sync_id,
            new_version=flow.version,
            conflicts=resolved_conflicts,
        )

    async def _delete(self, op: PushOperationRequest) -> PushOperationResult:
        flow = await self._pre_order_flow_repo.get_by_id(op.entity_id)

        if flow is None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.ERROR,
                message=f"PreOrderFlow {op.entity_id} not found",
            )

        # Already deleted — idempotent, nothing to do
        if flow.deleted_at is not None:
            return PushOperationResult(
                operation_id=op.id,
                status=PushResultStatus.SUCCESS,
                new_version=flow.version,
                message=f"PreOrderFlow {op.entity_id} already deleted, no-op",
            )

        # Version mismatch on DELETE — apply LWW: only reject if the server
        # was updated more recently than the client's delete request.
        if op.expected_version is not None and op.expected_version != flow.version:
            client_dt = parse_timestamp(op.timestamp)
            server_dt = parse_timestamp(
                flow.updated_at.isoformat() if flow.updated_at else op.timestamp,
            )
            if client_dt < server_dt:
                return PushOperationResult(
                    operation_id=op.id,
                    status=PushResultStatus.CONFLICT,
                    new_version=flow.version,
                    message=f"Delete rejected: entity was updated on server (version {flow.version}) after client delete request (expected version {op.expected_version})",
                )

        flow = await self._pre_order_flow_repo.soft_delete(flow)

        log_entry = await self._op_log_repo.record(
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=flow.id,
            operation_type=OperationType.DELETE,
            data=PreOrderFlowRepository.snapshot(flow),
        )

        return PushOperationResult(
            operation_id=op.id,
            status=PushResultStatus.SUCCESS,
            sync_id=log_entry.sync_id,
            new_version=flow.version,
        )
