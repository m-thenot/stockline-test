from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.models import PreOrderFlow
from app.schemas import (
    EntityType,
    OperationType,
    PushOperationRequest,
    PushResultStatus,
)
from app.services.conflict_resolver import ConflictResolver
from app.services.pre_order_flow_sync_service import PreOrderFlowSyncService
from tests.fake_repositories import (
    FakeOperationLogRepository,
    FakePreOrderFlowRepository,
)


@pytest.fixture
def fake_pre_order_flow_repo() -> FakePreOrderFlowRepository:
    """Fixture providing a fresh FakePreOrderFlowRepository instance."""
    return FakePreOrderFlowRepository()


@pytest.fixture
def fake_op_log_repo() -> FakeOperationLogRepository:
    """Fixture providing a fresh FakeOperationLogRepository instance."""
    return FakeOperationLogRepository()


@pytest.fixture
def conflict_resolver() -> ConflictResolver:
    """Fixture providing a ConflictResolver instance."""
    return ConflictResolver()


@pytest.fixture
def pre_order_flow_sync_service(
    fake_pre_order_flow_repo: FakePreOrderFlowRepository,
    fake_op_log_repo: FakeOperationLogRepository,
    conflict_resolver: ConflictResolver,
) -> PreOrderFlowSyncService:
    """Fixture providing a PreOrderFlowSyncService with fake dependencies."""
    return PreOrderFlowSyncService(
        repo=fake_pre_order_flow_repo,  # type: ignore[arg-type]
        op_log_repo=fake_op_log_repo,
        conflict_resolver=conflict_resolver,
    )


@pytest.fixture
def sample_pre_order_flow() -> PreOrderFlow:
    """Fixture providing a sample PreOrderFlow entity."""
    now = datetime.now(UTC)
    return PreOrderFlow(
        id=uuid.uuid4(),
        pre_order_id=uuid.uuid4(),
        product_id=uuid.uuid4(),
        unit_id=uuid.uuid4(),
        quantity=10.5,
        price=25.99,
        comment="Test comment",
        created_at=now,
        updated_at=now,
        version=1,
        deleted_at=None,
    )


@pytest.fixture
def sample_create_request() -> PushOperationRequest:
    """Fixture providing a sample CREATE operation request."""
    return PushOperationRequest(
        id="op-1",
        entity_type=EntityType.PRE_ORDER_FLOW,
        entity_id=uuid.uuid4(),
        operation_type=OperationType.CREATE,
        data={
            "pre_order_id": str(uuid.uuid4()),
            "product_id": str(uuid.uuid4()),
            "unit_id": str(uuid.uuid4()),
            "quantity": 10.5,
            "price": 25.99,
            "comment": "Test comment",
        },
        timestamp="2024-01-15T10:00:00Z",
    )


@pytest.fixture
def sample_update_request() -> PushOperationRequest:
    """Fixture providing a sample UPDATE operation request."""
    return PushOperationRequest(
        id="op-2",
        entity_type=EntityType.PRE_ORDER_FLOW,
        entity_id=uuid.uuid4(),
        operation_type=OperationType.UPDATE,
        data={"quantity": 20.0, "comment": "Updated comment"},
        expected_version=1,
        timestamp="2024-01-15T10:00:00Z",
    )


@pytest.fixture
def sample_delete_request() -> PushOperationRequest:
    """Fixture providing a sample DELETE operation request."""
    return PushOperationRequest(
        id="op-3",
        entity_type=EntityType.PRE_ORDER_FLOW,
        entity_id=uuid.uuid4(),
        operation_type=OperationType.DELETE,
        data={},
        expected_version=1,
        timestamp="2024-01-15T10:00:00Z",
    )


class TestCreateOperations:
    """Tests for CREATE operations."""

    @pytest.mark.asyncio
    async def test_create_success(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
        fake_op_log_repo: FakeOperationLogRepository,
    ) -> None:
        """Successful creation of PreOrderFlow."""
        request = PushOperationRequest(
            id="op-create-1",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={
                "pre_order_id": str(uuid.uuid4()),
                "product_id": str(uuid.uuid4()),
                "unit_id": str(uuid.uuid4()),
                "quantity": 10.5,
                "price": 25.99,
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.sync_id == 1
        assert result.new_version == 1
        assert result.message is None

        # Verify entity was created
        entity = await fake_pre_order_flow_repo.get_by_id(request.entity_id)
        assert entity is not None
        assert entity.quantity == 10.5
        assert entity.price == 25.99
        assert entity.version == 1

        # Verify operation log entry
        assert len(fake_op_log_repo._storage) == 1
        log_entry = fake_op_log_repo._storage[0]
        assert log_entry.operation_type == "CREATE"
        assert log_entry.entity_id == request.entity_id

    @pytest.mark.asyncio
    async def test_create_idempotent(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
        sample_pre_order_flow: PreOrderFlow,
    ) -> None:
        """Creating same entity twice returns success (idempotency)."""
        # Create entity first time
        await fake_pre_order_flow_repo.create(
            entity_id=sample_pre_order_flow.id,
            pre_order_id=sample_pre_order_flow.pre_order_id,
            product_id=sample_pre_order_flow.product_id,
            unit_id=sample_pre_order_flow.unit_id,
            quantity=sample_pre_order_flow.quantity,
            price=sample_pre_order_flow.price,
            comment=sample_pre_order_flow.comment,
        )

        request = PushOperationRequest(
            id="op-create-2",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=sample_pre_order_flow.id,
            operation_type=OperationType.CREATE,
            data={
                "pre_order_id": str(sample_pre_order_flow.pre_order_id),
                "product_id": str(sample_pre_order_flow.product_id),
                "unit_id": str(sample_pre_order_flow.unit_id),
                "quantity": sample_pre_order_flow.quantity,
                "price": sample_pre_order_flow.price,
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.new_version == 1
        assert result.message is not None
        assert "already exists" in result.message.lower()
        assert "idempotent" in result.message.lower()

    @pytest.mark.asyncio
    async def test_create_missing_pre_order_id(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
    ) -> None:
        """Missing pre_order_id raises error."""
        request = PushOperationRequest(
            id="op-create-3",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={
                "product_id": str(uuid.uuid4()),
                "unit_id": str(uuid.uuid4()),
                "quantity": 10.5,
                "price": 25.99,
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "validation error" in result.message.lower()
        assert "pre_order_id" in result.message.lower()

    @pytest.mark.asyncio
    async def test_create_missing_product_id(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
    ) -> None:
        """Missing product_id raises error."""
        request = PushOperationRequest(
            id="op-create-4",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={
                "pre_order_id": str(uuid.uuid4()),
                "unit_id": str(uuid.uuid4()),
                "quantity": 10.5,
                "price": 25.99,
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "validation error" in result.message.lower()
        assert "product_id" in result.message.lower()

    @pytest.mark.asyncio
    async def test_create_missing_unit_id(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
    ) -> None:
        """Missing unit_id raises error."""
        request = PushOperationRequest(
            id="op-create-5",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={
                "pre_order_id": str(uuid.uuid4()),
                "product_id": str(uuid.uuid4()),
                "quantity": 10.5,
                "price": 25.99,
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "validation error" in result.message.lower()
        assert "unit_id" in result.message.lower()

    @pytest.mark.asyncio
    async def test_create_missing_quantity(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
    ) -> None:
        """Missing quantity raises error."""
        request = PushOperationRequest(
            id="op-create-6",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={
                "pre_order_id": str(uuid.uuid4()),
                "product_id": str(uuid.uuid4()),
                "unit_id": str(uuid.uuid4()),
                "price": 25.99,
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "validation error" in result.message.lower()
        assert "quantity" in result.message.lower()

    @pytest.mark.asyncio
    async def test_create_missing_price(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
    ) -> None:
        """Missing price raises error."""
        request = PushOperationRequest(
            id="op-create-7",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={
                "pre_order_id": str(uuid.uuid4()),
                "product_id": str(uuid.uuid4()),
                "unit_id": str(uuid.uuid4()),
                "quantity": 10.5,
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "validation error" in result.message.lower()
        assert "price" in result.message.lower()

    @pytest.mark.asyncio
    async def test_create_invalid_uuid(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
    ) -> None:
        """Invalid UUID format raises error."""
        request = PushOperationRequest(
            id="op-create-8",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={
                "pre_order_id": "not-a-valid-uuid",
                "product_id": str(uuid.uuid4()),
                "unit_id": str(uuid.uuid4()),
                "quantity": 10.5,
                "price": 25.99,
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "validation error" in result.message.lower()

    @pytest.mark.asyncio
    async def test_create_with_optional_fields(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
    ) -> None:
        """Creation with comment works."""
        entity_id = uuid.uuid4()
        request = PushOperationRequest(
            id="op-create-9",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=entity_id,
            operation_type=OperationType.CREATE,
            data={
                "pre_order_id": str(uuid.uuid4()),
                "product_id": str(uuid.uuid4()),
                "unit_id": str(uuid.uuid4()),
                "quantity": 10.5,
                "price": 25.99,
                "comment": "Test comment",
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS

        entity = await fake_pre_order_flow_repo.get_by_id(entity_id)
        assert entity is not None
        assert entity.comment == "Test comment"

    @pytest.mark.asyncio
    async def test_create_float_conversion(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
    ) -> None:
        """String numbers converted to float."""
        entity_id = uuid.uuid4()
        request = PushOperationRequest(
            id="op-create-10",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=entity_id,
            operation_type=OperationType.CREATE,
            data={
                "pre_order_id": str(uuid.uuid4()),
                "product_id": str(uuid.uuid4()),
                "unit_id": str(uuid.uuid4()),
                "quantity": "10.5",  # String
                "price": "25.99",  # String
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS

        entity = await fake_pre_order_flow_repo.get_by_id(entity_id)
        assert entity is not None
        assert entity.quantity == 10.5
        assert entity.price == 25.99


class TestUpdateOperations:
    """Tests for UPDATE operations."""

    @pytest.mark.asyncio
    async def test_update_success(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
        fake_op_log_repo: FakeOperationLogRepository,
    ) -> None:
        """Successful update with version match."""
        # Create entity first
        entity_id = uuid.uuid4()
        await fake_pre_order_flow_repo.create(
            entity_id=entity_id,
            pre_order_id=uuid.uuid4(),
            product_id=uuid.uuid4(),
            unit_id=uuid.uuid4(),
            quantity=10.5,
            price=25.99,
        )

        request = PushOperationRequest(
            id="op-update-1",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=entity_id,
            operation_type=OperationType.UPDATE,
            data={"quantity": 20.0, "comment": "Updated"},
            expected_version=1,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.sync_id == 1
        assert result.new_version == 2
        assert result.conflicts is None

        # Verify entity was updated
        updated_entity = await fake_pre_order_flow_repo.get_by_id(entity_id)
        assert updated_entity is not None
        assert updated_entity.quantity == 20.0
        assert updated_entity.comment == "Updated"
        assert updated_entity.version == 2

    @pytest.mark.asyncio
    async def test_update_not_found(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
    ) -> None:
        """Updating non-existent entity returns error."""
        request = PushOperationRequest(
            id="op-update-2",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.UPDATE,
            data={"quantity": 20.0},
            expected_version=1,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "not found" in result.message.lower()

    @pytest.mark.asyncio
    async def test_update_version_mismatch_no_conflict(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
        fake_op_log_repo: FakeOperationLogRepository,
    ) -> None:
        """Version mismatch but no conflicts (auto-merge)."""
        # Create entity
        entity_id = uuid.uuid4()
        entity = await fake_pre_order_flow_repo.create(
            entity_id=entity_id,
            pre_order_id=uuid.uuid4(),
            product_id=uuid.uuid4(),
            unit_id=uuid.uuid4(),
            quantity=10.5,
            price=25.99,
        )

        # Simulate server update (version 2)
        entity = await fake_pre_order_flow_repo.apply_update(entity, {"quantity": 15.0})
        await fake_op_log_repo.record(
            entity_type="pre_order_flow",
            entity_id=entity_id,
            operation_type="UPDATE",
            data={"quantity": 15.0, "version": 2},
        )

        # Client tries to update with expected_version=1, but server is at version 2
        # Client changes a field that wasn't changed on server -> auto-merge
        request = PushOperationRequest(
            id="op-update-3",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=entity_id,
            operation_type=OperationType.UPDATE,
            data={"comment": "Client comment"},
            expected_version=1,
            timestamp="2024-01-15T11:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.new_version == 3

        # Verify comment was applied (auto-merged)
        updated_entity = await fake_pre_order_flow_repo.get_by_id(entity_id)
        assert updated_entity is not None
        assert updated_entity.comment == "Client comment"

    @pytest.mark.asyncio
    async def test_update_version_mismatch_with_conflicts(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
        fake_op_log_repo: FakeOperationLogRepository,
    ) -> None:
        """Version mismatch with LWW conflict resolution."""
        # Create entity
        entity_id = uuid.uuid4()
        entity = await fake_pre_order_flow_repo.create(
            entity_id=entity_id,
            pre_order_id=uuid.uuid4(),
            product_id=uuid.uuid4(),
            unit_id=uuid.uuid4(),
            quantity=10.5,
            price=25.99,
            comment="Original",
        )

        # Simulate server update (version 2) - server changed comment
        entity = await fake_pre_order_flow_repo.apply_update(entity, {"comment": "Server comment"})
        # Use a fixed timestamp older than client timestamp so client wins
        server_timestamp = datetime.fromisoformat("2024-01-15T09:00:00+00:00")
        await fake_op_log_repo.record(
            entity_type="pre_order_flow",
            entity_id=entity_id,
            operation_type="UPDATE",
            data={"comment": "Server comment", "version": 2},
            timestamp=server_timestamp,
        )

        # Client tries to update with expected_version=1, but server is at version 2
        # Client also changed comment -> LWW conflict
        request = PushOperationRequest(
            id="op-update-4",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=entity_id,
            operation_type=OperationType.UPDATE,
            data={"comment": "Client comment"},
            expected_version=1,
            timestamp="2024-01-15T11:00:00Z",  # Client timestamp is newer
        )

        result = await pre_order_flow_sync_service.handle(request)

        # Should succeed with conflicts reported
        assert result.status == PushResultStatus.SUCCESS
        assert result.new_version == 3
        assert result.conflicts is not None
        assert len(result.conflicts) == 1
        assert result.conflicts[0].field == "comment"
        assert result.conflicts[0].client_value == "Client comment"
        assert result.conflicts[0].server_value == "Server comment"

        # Verify client value was applied (client wins due to newer timestamp)
        updated_entity = await fake_pre_order_flow_repo.get_by_id(entity_id)
        assert updated_entity is not None
        assert updated_entity.comment == "Client comment"

    @pytest.mark.asyncio
    async def test_update_already_deleted(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
        sample_pre_order_flow: PreOrderFlow,
    ) -> None:
        """Updating deleted entity returns success (no-op)."""
        # Create and delete entity
        entity = await fake_pre_order_flow_repo.create(
            entity_id=sample_pre_order_flow.id,
            pre_order_id=sample_pre_order_flow.pre_order_id,
            product_id=sample_pre_order_flow.product_id,
            unit_id=sample_pre_order_flow.unit_id,
            quantity=sample_pre_order_flow.quantity,
            price=sample_pre_order_flow.price,
        )
        await fake_pre_order_flow_repo.soft_delete(entity)

        request = PushOperationRequest(
            id="op-update-5",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=sample_pre_order_flow.id,
            operation_type=OperationType.UPDATE,
            data={"quantity": 20.0},
            expected_version=2,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        # Base service checks deleted_at and returns success (idempotency)
        assert result.status == PushResultStatus.SUCCESS
        assert result.new_version == 2
        assert result.message is not None
        assert "already deleted" in result.message.lower()

    @pytest.mark.asyncio
    async def test_update_no_changes(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
    ) -> None:
        """Update with no field changes returns success."""
        # Create entity
        entity_id = uuid.uuid4()
        await fake_pre_order_flow_repo.create(
            entity_id=entity_id,
            pre_order_id=uuid.uuid4(),
            product_id=uuid.uuid4(),
            unit_id=uuid.uuid4(),
            quantity=10.5,
            price=25.99,
        )

        # Try to update with empty data
        request = PushOperationRequest(
            id="op-update-6",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=entity_id,
            operation_type=OperationType.UPDATE,
            data={},
            expected_version=1,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.message is not None
        assert "no changes" in result.message.lower() or "no-op" in result.message.lower()


# ============================================================================
# DELETE Operation Tests
# ============================================================================


class TestDeleteOperations:
    """Tests for DELETE operations."""

    @pytest.mark.asyncio
    async def test_delete_success(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
        fake_op_log_repo: FakeOperationLogRepository,
    ) -> None:
        """Successful soft-delete."""
        # Create entity
        entity_id = uuid.uuid4()
        await fake_pre_order_flow_repo.create(
            entity_id=entity_id,
            pre_order_id=uuid.uuid4(),
            product_id=uuid.uuid4(),
            unit_id=uuid.uuid4(),
            quantity=10.5,
            price=25.99,
        )

        request = PushOperationRequest(
            id="op-delete-1",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=entity_id,
            operation_type=OperationType.DELETE,
            data={},
            expected_version=1,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.sync_id == 1
        assert result.new_version == 2

        # Verify deleted_at is set in storage
        deleted_entity = await fake_pre_order_flow_repo.get_by_id(entity_id)
        assert deleted_entity is not None
        assert deleted_entity.deleted_at is not None
        assert deleted_entity.version == 2

    @pytest.mark.asyncio
    async def test_delete_not_found(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
    ) -> None:
        """Deleting non-existent entity returns error."""
        request = PushOperationRequest(
            id="op-delete-2",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.DELETE,
            data={},
            expected_version=1,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "not found" in result.message.lower()

    @pytest.mark.asyncio
    async def test_delete_already_deleted(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
        sample_pre_order_flow: PreOrderFlow,
    ) -> None:
        """Deleting already deleted entity returns success (idempotency)."""
        # Create and delete entity
        entity = await fake_pre_order_flow_repo.create(
            entity_id=sample_pre_order_flow.id,
            pre_order_id=sample_pre_order_flow.pre_order_id,
            product_id=sample_pre_order_flow.product_id,
            unit_id=sample_pre_order_flow.unit_id,
            quantity=sample_pre_order_flow.quantity,
            price=sample_pre_order_flow.price,
        )
        await fake_pre_order_flow_repo.soft_delete(entity)

        request = PushOperationRequest(
            id="op-delete-3",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=sample_pre_order_flow.id,
            operation_type=OperationType.DELETE,
            data={},
            expected_version=2,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_flow_sync_service.handle(request)

        # Base service checks deleted_at and returns success (idempotency)
        assert result.status == PushResultStatus.SUCCESS
        assert result.new_version == 2
        assert result.message is not None
        assert "already deleted" in result.message.lower()

    @pytest.mark.asyncio
    async def test_delete_version_conflict(
        self,
        pre_order_flow_sync_service: PreOrderFlowSyncService,
        fake_pre_order_flow_repo: FakePreOrderFlowRepository,
    ) -> None:
        """Delete with version mismatch returns conflict."""
        # Create entity
        entity_id = uuid.uuid4()
        entity = await fake_pre_order_flow_repo.create(
            entity_id=entity_id,
            pre_order_id=uuid.uuid4(),
            product_id=uuid.uuid4(),
            unit_id=uuid.uuid4(),
            quantity=10.5,
            price=25.99,
        )

        # Simulate server update (version 2)
        entity = await fake_pre_order_flow_repo.apply_update(entity, {"quantity": 20.0})

        # Client tries to delete with expected_version=1, but server is at version 2
        # Client timestamp is older than server update
        request = PushOperationRequest(
            id="op-delete-4",
            entity_type=EntityType.PRE_ORDER_FLOW,
            entity_id=entity_id,
            operation_type=OperationType.DELETE,
            data={},
            expected_version=1,
            timestamp="2024-01-15T09:00:00Z",  # Older timestamp
        )

        result = await pre_order_flow_sync_service.handle(request)

        assert result.status == PushResultStatus.CONFLICT
        assert result.new_version == 2
        assert result.message is not None
        assert "rejected" in result.message.lower() or "conflict" in result.message.lower()

        # Verify entity was NOT deleted (conflict prevented deletion)
        entity_check = await fake_pre_order_flow_repo.get_by_id(entity_id)
        assert entity_check is not None
        assert entity_check.deleted_at is None
        assert entity_check.version == 2  # Version wasn't incremented
