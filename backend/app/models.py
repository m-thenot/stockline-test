import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    short_name = Column(String(50), nullable=True)
    sku = Column(String(50), nullable=True)
    code = Column(String(50), nullable=True)


class Partner(Base):
    __tablename__ = "partners"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    code = Column(String(50), nullable=True)
    type = Column(Integer, nullable=False, default=1)  # 1=client, 2=supplier

    pre_orders = relationship("PreOrder", back_populates="partner", lazy="noload")


class Unit(Base):
    __tablename__ = "units"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    abbreviation = Column(String(10), nullable=False)


class PreOrder(Base):
    __tablename__ = "pre_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    partner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("partners.id"))
    status: Mapped[int] = mapped_column(Integer, default=0)  # 0=pending, 1=confirmed
    order_date: Mapped[str | None] = mapped_column(String(10), default=None)  # YYYY-MM-DD
    delivery_date: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD
    comment: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    partner: Mapped["Partner"] = relationship(back_populates="pre_orders", lazy="selectin")
    flows: Mapped[list["PreOrderFlow"]] = relationship(
        back_populates="pre_order",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class PreOrderFlow(Base):
    __tablename__ = "pre_order_flows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pre_order_id = Column(
        UUID(as_uuid=True),
        ForeignKey("pre_orders.id", ondelete="CASCADE"),
        nullable=False,
    )
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    quantity = Column(Float, nullable=False, default=0)
    price = Column(Float, nullable=False, default=0)
    unit_id = Column(UUID(as_uuid=True), ForeignKey("units.id"), nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    version = Column(Integer, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    pre_order = relationship("PreOrder", back_populates="flows", lazy="noload")
    product = relationship("Product", lazy="selectin")
    unit = relationship("Unit", lazy="selectin")


class OperationLog(Base):
    __tablename__ = "operation_log"

    sync_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    operation_type: Mapped[str] = mapped_column(String(10))
    data: Mapped[dict] = mapped_column(JSONB)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), default=None)
    timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (Index("ix_oplog_entity", "entity_type", "entity_id"),)
