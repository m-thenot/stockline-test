from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.models import PreOrder
from app.schemas import (
    EntityType,
    OperationType,
    PushOperationRequest,
    PushResultStatus,
)
from app.services.conflict_resolver import ConflictResolver
from app.services.pre_order_sync_service import PreOrderSyncService
from tests.fake_repositories import (
    FakeOperationLogRepository,
    FakePreOrderRepository,
)


@pytest.fixture
def fake_pre_order_repo() -> FakePreOrderRepository:
    """Fixture providing a fresh FakePreOrderRepository instance."""
    return FakePreOrderRepository()


@pytest.fixture
def fake_op_log_repo() -> FakeOperationLogRepository:
    """Fixture providing a fresh FakeOperationLogRepository instance."""
    return FakeOperationLogRepository()


@pytest.fixture
def conflict_resolver() -> ConflictResolver:
    """Fixture providing a ConflictResolver instance."""
    return ConflictResolver()


@pytest.fixture
def pre_order_sync_service(
    fake_pre_order_repo: FakePreOrderRepository,
    fake_op_log_repo: FakeOperationLogRepository,
    conflict_resolver: ConflictResolver,
) -> PreOrderSyncService:
    """Fixture providing a PreOrderSyncService with fake dependencies."""
    return PreOrderSyncService(
        repo=fake_pre_order_repo,  # type: ignore[arg-type]
        op_log_repo=fake_op_log_repo,
        conflict_resolver=conflict_resolver,
    )


@pytest.fixture
def sample_pre_order() -> PreOrder:
    """Fixture providing a sample PreOrder entity."""
    now = datetime.now(UTC)
    return PreOrder(
        id=uuid.uuid4(),
        partner_id=uuid.uuid4(),
        status=0,
        order_date="2024-01-15",
        delivery_date="2024-01-20",
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
        entity_type=EntityType.PRE_ORDER,
        entity_id=uuid.uuid4(),
        operation_type=OperationType.CREATE,
        data={
            "partner_id": str(uuid.uuid4()),
            "delivery_date": "2024-01-20",
            "status": 0,
            "order_date": "2024-01-15",
            "comment": "Test comment",
        },
        timestamp="2024-01-15T10:00:00Z",
    )


@pytest.fixture
def sample_update_request() -> PushOperationRequest:
    """Fixture providing a sample UPDATE operation request."""
    return PushOperationRequest(
        id="op-2",
        entity_type=EntityType.PRE_ORDER,
        entity_id=uuid.uuid4(),
        operation_type=OperationType.UPDATE,
        data={"status": 1, "comment": "Updated comment"},
        expected_version=1,
        timestamp="2024-01-15T10:00:00Z",
    )


@pytest.fixture
def sample_delete_request() -> PushOperationRequest:
    """Fixture providing a sample DELETE operation request."""
    return PushOperationRequest(
        id="op-3",
        entity_type=EntityType.PRE_ORDER,
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
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
        fake_op_log_repo: FakeOperationLogRepository,
    ) -> None:
        """Successful creation of PreOrder."""
        request = PushOperationRequest(
            id="op-create-1",
            entity_type=EntityType.PRE_ORDER,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={
                "partner_id": str(uuid.uuid4()),
                "delivery_date": "2024-01-20",
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.sync_id == 1
        assert result.new_version == 1
        assert result.message is None

        # Verify entity was created
        entity = await fake_pre_order_repo.get_by_id(request.entity_id)
        assert entity is not None
        assert entity.delivery_date == "2024-01-20"
        assert entity.version == 1

        # Verify operation log entry
        assert len(fake_op_log_repo._storage) == 1
        log_entry = fake_op_log_repo._storage[0]
        assert log_entry.operation_type == "CREATE"
        assert log_entry.entity_id == request.entity_id

    @pytest.mark.asyncio
    async def test_create_idempotent(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
        sample_pre_order: PreOrder,
    ) -> None:
        """Creating same entity twice returns success (idempotency)."""
        # Create entity first time
        await fake_pre_order_repo.create(
            entity_id=sample_pre_order.id,
            partner_id=sample_pre_order.partner_id,
            delivery_date=sample_pre_order.delivery_date,
            status=sample_pre_order.status,
            order_date=sample_pre_order.order_date,
            comment=sample_pre_order.comment,
        )

        request = PushOperationRequest(
            id="op-create-2",
            entity_type=EntityType.PRE_ORDER,
            entity_id=sample_pre_order.id,
            operation_type=OperationType.CREATE,
            data={
                "partner_id": str(sample_pre_order.partner_id),
                "delivery_date": sample_pre_order.delivery_date,
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.new_version == 1
        assert result.message is not None
        assert "already exists" in result.message.lower()
        assert "idempotent" in result.message.lower()

    @pytest.mark.asyncio
    async def test_create_missing_required_field(
        self,
        pre_order_sync_service: PreOrderSyncService,
    ) -> None:
        """Missing required field raises error."""
        # Missing delivery_date
        request = PushOperationRequest(
            id="op-create-3",
            entity_type=EntityType.PRE_ORDER,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={"partner_id": str(uuid.uuid4())},
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "validation error" in result.message.lower()
        assert (
            "missing required field" in result.message.lower()
            or "delivery_date" in result.message.lower()
        )

    @pytest.mark.asyncio
    async def test_create_missing_partner_id(
        self,
        pre_order_sync_service: PreOrderSyncService,
    ) -> None:
        """Missing partner_id raises error."""
        request = PushOperationRequest(
            id="op-create-4",
            entity_type=EntityType.PRE_ORDER,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={"delivery_date": "2024-01-20"},
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "validation error" in result.message.lower()
        assert "partner_id" in result.message.lower()

    @pytest.mark.asyncio
    async def test_create_invalid_uuid(
        self,
        pre_order_sync_service: PreOrderSyncService,
    ) -> None:
        """Invalid partner_id UUID format raises error."""
        request = PushOperationRequest(
            id="op-create-5",
            entity_type=EntityType.PRE_ORDER,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.CREATE,
            data={
                "partner_id": "not-a-valid-uuid",
                "delivery_date": "2024-01-20",
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "validation error" in result.message.lower()

    @pytest.mark.asyncio
    async def test_create_with_optional_fields(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
    ) -> None:
        """Creation with order_date, comment, status works."""
        entity_id = uuid.uuid4()
        partner_id = uuid.uuid4()
        request = PushOperationRequest(
            id="op-create-6",
            entity_type=EntityType.PRE_ORDER,
            entity_id=entity_id,
            operation_type=OperationType.CREATE,
            data={
                "partner_id": str(partner_id),
                "delivery_date": "2024-01-20",
                "status": 1,
                "order_date": "2024-01-15",
                "comment": "Test comment",
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS

        entity = await fake_pre_order_repo.get_by_id(entity_id)
        assert entity is not None
        assert entity.status == 1
        assert entity.order_date == "2024-01-15"
        assert entity.comment == "Test comment"

    @pytest.mark.asyncio
    async def test_create_default_status(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
    ) -> None:
        """Status defaults to 0 if not provided."""
        entity_id = uuid.uuid4()
        request = PushOperationRequest(
            id="op-create-7",
            entity_type=EntityType.PRE_ORDER,
            entity_id=entity_id,
            operation_type=OperationType.CREATE,
            data={
                "partner_id": str(uuid.uuid4()),
                "delivery_date": "2024-01-20",
            },
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS

        entity = await fake_pre_order_repo.get_by_id(entity_id)
        assert entity is not None
        assert entity.status == 0


class TestUpdateOperations:
    """Tests for UPDATE operations."""

    @pytest.mark.asyncio
    async def test_update_success(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
        fake_op_log_repo: FakeOperationLogRepository,
    ) -> None:
        """Successful update with version match."""
        # Create entity first
        entity_id = uuid.uuid4()
        partner_id = uuid.uuid4()
        await fake_pre_order_repo.create(
            entity_id=entity_id,
            partner_id=partner_id,
            delivery_date="2024-01-20",
            status=0,
        )

        request = PushOperationRequest(
            id="op-update-1",
            entity_type=EntityType.PRE_ORDER,
            entity_id=entity_id,
            operation_type=OperationType.UPDATE,
            data={"status": 1, "comment": "Updated"},
            expected_version=1,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.sync_id == 1
        assert result.new_version == 2
        assert result.conflicts is None

        # Verify entity was updated
        updated_entity = await fake_pre_order_repo.get_by_id(entity_id)
        assert updated_entity is not None
        assert updated_entity.status == 1
        assert updated_entity.comment == "Updated"
        assert updated_entity.version == 2

    @pytest.mark.asyncio
    async def test_update_not_found(
        self,
        pre_order_sync_service: PreOrderSyncService,
    ) -> None:
        """Updating non-existent entity returns error."""
        request = PushOperationRequest(
            id="op-update-2",
            entity_type=EntityType.PRE_ORDER,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.UPDATE,
            data={"status": 1},
            expected_version=1,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "not found" in result.message.lower()

    @pytest.mark.asyncio
    async def test_update_version_mismatch_no_conflict(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
        fake_op_log_repo: FakeOperationLogRepository,
    ) -> None:
        """Version mismatch but no conflicts (auto-merge)."""
        # Create entity
        entity_id = uuid.uuid4()
        partner_id = uuid.uuid4()
        entity = await fake_pre_order_repo.create(
            entity_id=entity_id,
            partner_id=partner_id,
            delivery_date="2024-01-20",
            status=0,
        )

        # Simulate server update (version 2)
        entity = await fake_pre_order_repo.apply_update(entity, {"status": 1})
        await fake_op_log_repo.record(
            entity_type="pre_order",
            entity_id=entity_id,
            operation_type="UPDATE",
            data={"status": 1, "version": 2},
        )

        # Client tries to update with expected_version=1, but server is at version 2
        # Client changes a field that wasn't changed on server -> auto-merge
        request = PushOperationRequest(
            id="op-update-3",
            entity_type=EntityType.PRE_ORDER,
            entity_id=entity_id,
            operation_type=OperationType.UPDATE,
            data={"comment": "Client comment"},
            expected_version=1,
            timestamp="2024-01-15T11:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.new_version == 3

        # Verify comment was applied (auto-merged)
        updated_entity = await fake_pre_order_repo.get_by_id(entity_id)
        assert updated_entity is not None
        assert updated_entity.comment == "Client comment"

    @pytest.mark.asyncio
    async def test_update_version_mismatch_with_conflicts(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
        fake_op_log_repo: FakeOperationLogRepository,
    ) -> None:
        """Version mismatch with LWW conflict resolution."""
        # Create entity
        entity_id = uuid.uuid4()
        partner_id = uuid.uuid4()
        entity = await fake_pre_order_repo.create(
            entity_id=entity_id,
            partner_id=partner_id,
            delivery_date="2024-01-20",
            status=0,
            comment="Original",
        )

        # Simulate server update (version 2) - server changed comment
        entity = await fake_pre_order_repo.apply_update(entity, {"comment": "Server comment"})
        # Use a fixed timestamp older than client timestamp so client wins
        server_timestamp = datetime.fromisoformat("2024-01-15T09:00:00+00:00")
        await fake_op_log_repo.record(
            entity_type="pre_order",
            entity_id=entity_id,
            operation_type="UPDATE",
            data={"comment": "Server comment", "version": 2},
            timestamp=server_timestamp,
        )

        # Client tries to update with expected_version=1, but server is at version 2
        # Client also changed comment -> LWW conflict
        request = PushOperationRequest(
            id="op-update-4",
            entity_type=EntityType.PRE_ORDER,
            entity_id=entity_id,
            operation_type=OperationType.UPDATE,
            data={"comment": "Client comment"},
            expected_version=1,
            timestamp="2024-01-15T11:00:00Z",  # Client timestamp is newer
        )

        result = await pre_order_sync_service.handle(request)

        # Should succeed with conflicts reported
        assert result.status == PushResultStatus.SUCCESS
        assert result.new_version == 3
        assert result.conflicts is not None
        assert len(result.conflicts) == 1
        assert result.conflicts[0].field == "comment"
        assert result.conflicts[0].client_value == "Client comment"
        assert result.conflicts[0].server_value == "Server comment"

        # Verify client value was applied (client wins due to newer timestamp)
        updated_entity = await fake_pre_order_repo.get_by_id(entity_id)
        assert updated_entity is not None
        assert updated_entity.comment == "Client comment"

    @pytest.mark.asyncio
    async def test_update_already_deleted(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
        sample_pre_order: PreOrder,
    ) -> None:
        """Updating deleted entity returns success (no-op)."""
        # Create and delete entity
        entity = await fake_pre_order_repo.create(
            entity_id=sample_pre_order.id,
            partner_id=sample_pre_order.partner_id,
            delivery_date=sample_pre_order.delivery_date,
        )
        await fake_pre_order_repo.soft_delete(entity)
        # Keep entity reference for test
        _ = entity

        request = PushOperationRequest(
            id="op-update-5",
            entity_type=EntityType.PRE_ORDER,
            entity_id=sample_pre_order.id,
            operation_type=OperationType.UPDATE,
            data={"status": 1},
            expected_version=2,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        # Base service checks deleted_at and returns success (idempotency)
        assert result.status == PushResultStatus.SUCCESS
        assert result.new_version == 2
        assert result.message is not None
        assert "already deleted" in result.message.lower()

    @pytest.mark.asyncio
    async def test_update_no_changes(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
    ) -> None:
        """Update with no field changes returns success."""
        # Create entity
        entity_id = uuid.uuid4()
        partner_id = uuid.uuid4()
        await fake_pre_order_repo.create(
            entity_id=entity_id,
            partner_id=partner_id,
            delivery_date="2024-01-20",
            status=0,
        )

        # Try to update with empty data
        request = PushOperationRequest(
            id="op-update-6",
            entity_type=EntityType.PRE_ORDER,
            entity_id=entity_id,
            operation_type=OperationType.UPDATE,
            data={},
            expected_version=1,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.message is not None
        assert "no changes" in result.message.lower() or "no-op" in result.message.lower()


class TestDeleteOperations:
    """Tests for DELETE operations."""

    @pytest.mark.asyncio
    async def test_delete_success(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
        fake_op_log_repo: FakeOperationLogRepository,
    ) -> None:
        """Successful soft-delete."""
        # Create entity
        entity_id = uuid.uuid4()
        partner_id = uuid.uuid4()
        await fake_pre_order_repo.create(
            entity_id=entity_id,
            partner_id=partner_id,
            delivery_date="2024-01-20",
        )

        request = PushOperationRequest(
            id="op-delete-1",
            entity_type=EntityType.PRE_ORDER,
            entity_id=entity_id,
            operation_type=OperationType.DELETE,
            data={},
            expected_version=1,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.SUCCESS
        assert result.sync_id == 1
        assert result.new_version == 2

        # Verify deleted_at is set in storage
        deleted_entity = await fake_pre_order_repo.get_by_id(entity_id)
        assert deleted_entity is not None
        assert deleted_entity.deleted_at is not None
        assert deleted_entity.version == 2

    @pytest.mark.asyncio
    async def test_delete_not_found(
        self,
        pre_order_sync_service: PreOrderSyncService,
    ) -> None:
        """Deleting non-existent entity returns error."""
        request = PushOperationRequest(
            id="op-delete-2",
            entity_type=EntityType.PRE_ORDER,
            entity_id=uuid.uuid4(),
            operation_type=OperationType.DELETE,
            data={},
            expected_version=1,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.ERROR
        assert result.message is not None
        assert "not found" in result.message.lower()

    @pytest.mark.asyncio
    async def test_delete_already_deleted(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
        sample_pre_order: PreOrder,
    ) -> None:
        """Deleting already deleted entity returns success (idempotency)."""
        # Create and delete entity
        entity = await fake_pre_order_repo.create(
            entity_id=sample_pre_order.id,
            partner_id=sample_pre_order.partner_id,
            delivery_date=sample_pre_order.delivery_date,
        )
        await fake_pre_order_repo.soft_delete(entity)
        # Keep entity reference for test
        _ = entity

        request = PushOperationRequest(
            id="op-delete-3",
            entity_type=EntityType.PRE_ORDER,
            entity_id=sample_pre_order.id,
            operation_type=OperationType.DELETE,
            data={},
            expected_version=2,
            timestamp="2024-01-15T10:00:00Z",
        )

        result = await pre_order_sync_service.handle(request)

        # Base service checks deleted_at and returns success (idempotency)
        assert result.status == PushResultStatus.SUCCESS
        assert result.new_version == 2
        assert result.message is not None
        assert "already deleted" in result.message.lower()

    @pytest.mark.asyncio
    async def test_delete_version_conflict(
        self,
        pre_order_sync_service: PreOrderSyncService,
        fake_pre_order_repo: FakePreOrderRepository,
    ) -> None:
        """Delete with version mismatch returns conflict."""
        # Create entity
        entity_id = uuid.uuid4()
        partner_id = uuid.uuid4()
        entity = await fake_pre_order_repo.create(
            entity_id=entity_id,
            partner_id=partner_id,
            delivery_date="2024-01-20",
        )

        # Simulate server update (version 2)
        entity = await fake_pre_order_repo.apply_update(entity, {"status": 1})

        # Client tries to delete with expected_version=1, but server is at version 2
        # Client timestamp is older than server update
        request = PushOperationRequest(
            id="op-delete-4",
            entity_type=EntityType.PRE_ORDER,
            entity_id=entity_id,
            operation_type=OperationType.DELETE,
            data={},
            expected_version=1,
            timestamp="2024-01-15T09:00:00Z",  # Older timestamp
        )

        result = await pre_order_sync_service.handle(request)

        assert result.status == PushResultStatus.CONFLICT
        assert result.new_version == 2
        assert result.message is not None
        assert "rejected" in result.message.lower() or "conflict" in result.message.lower()

        # Verify entity was NOT deleted (conflict prevented deletion)
        entity_check = await fake_pre_order_repo.get_by_id(entity_id)
        assert entity_check is not None
        assert entity_check.deleted_at is None
        assert entity_check.version == 2  # Version wasn't incremented
