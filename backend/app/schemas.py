from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict

# --- Response schemas ---


class ProductResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    short_name: str | None
    sku: str | None
    code: str | None


class PartnerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    code: str | None
    type: int


class UnitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    abbreviation: str


class FlowResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pre_order_id: uuid.UUID
    product_id: uuid.UUID
    product: ProductResponse | None
    quantity: float
    price: float
    unit_id: uuid.UUID
    unit: UnitResponse | None
    comment: str | None
    created_at: datetime | None
    updated_at: datetime | None


class PreOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    partner_id: uuid.UUID
    partner: PartnerResponse | None
    status: int
    order_date: str | None
    delivery_date: str
    comment: str | None
    flows: list[FlowResponse]
    created_at: datetime | None
    updated_at: datetime | None


class RecapPartnerGroup(BaseModel):
    partner: PartnerResponse
    pre_orders: list[PreOrderResponse]


# --- Snapshot schemas (flat, no nested relationships) ---


class PreOrderSnapshotResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    partner_id: uuid.UUID
    status: int
    order_date: str | None
    delivery_date: str
    comment: str | None
    created_at: datetime | None
    updated_at: datetime | None


class FlowSnapshotResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pre_order_id: uuid.UUID
    product_id: uuid.UUID
    quantity: float
    price: float
    unit_id: uuid.UUID
    comment: str | None
    created_at: datetime | None
    updated_at: datetime | None


# --- Create / Update schemas ---


class PreOrderCreate(BaseModel):
    partner_id: uuid.UUID
    status: int = 0
    order_date: str | None = None
    delivery_date: str
    comment: str | None = None


class PreOrderUpdate(BaseModel):
    partner_id: uuid.UUID | None = None
    status: int | None = None
    order_date: str | None = None
    delivery_date: str | None = None
    comment: str | None = None


class FlowCreate(BaseModel):
    product_id: uuid.UUID
    quantity: float
    price: float
    unit_id: uuid.UUID
    comment: str | None = None


class FlowUpdate(BaseModel):
    product_id: uuid.UUID | None = None
    quantity: float | None = None
    price: float | None = None
    unit_id: uuid.UUID | None = None
    comment: str | None = None


# --- Sync Push schemas ---


class EntityType(StrEnum):
    PRE_ORDER = "pre_order"
    PRE_ORDER_FLOW = "pre_order_flow"


class OperationType(StrEnum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"


class PushResultStatus(StrEnum):
    SUCCESS = "success"
    CONFLICT = "conflict"
    ERROR = "error"


class PushOperationRequest(BaseModel):
    id: str
    entity_type: EntityType
    entity_id: uuid.UUID
    operation_type: OperationType
    data: dict
    expected_version: int | None = None
    timestamp: str


class PushRequest(BaseModel):
    operations: list[PushOperationRequest]


class ConflictWinner(StrEnum):
    CLIENT = "client"
    SERVER = "server"


class ResolvedFieldConflict(BaseModel):
    field: str
    client_value: str | int | float | bool | None = None
    server_value: str | int | float | bool | None = None
    winner: ConflictWinner


class PushOperationResult(BaseModel):
    operation_id: str
    status: PushResultStatus
    sync_id: int | None = None
    new_version: int | None = None
    message: str | None = None
    conflicts: list[ResolvedFieldConflict] | None = None


class PushResponse(BaseModel):
    results: list[PushOperationResult]


# --- Sync Pull schemas ---


class PullOperationResponse(BaseModel):
    """A single operation from the operation_log."""

    sync_id: int
    entity_type: str
    entity_id: uuid.UUID
    operation_type: str
    data: dict
    timestamp: datetime


class PullResponse(BaseModel):
    """Response from GET /sync/pull."""

    operations: list[PullOperationResponse]
    has_more: bool
