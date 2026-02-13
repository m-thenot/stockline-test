from __future__ import annotations

import uuid
from datetime import datetime

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
