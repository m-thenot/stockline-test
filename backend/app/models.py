import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    partner_id = Column(UUID(as_uuid=True), ForeignKey("partners.id"), nullable=False)
    status = Column(Integer, nullable=False, default=0)  # 0=pending, 1=confirmed
    order_date = Column(String(10), nullable=True)  # YYYY-MM-DD string
    delivery_date = Column(String(10), nullable=False)  # YYYY-MM-DD string
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    partner = relationship("Partner", back_populates="pre_orders", lazy="selectin")
    flows = relationship(
        "PreOrderFlow",
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

    pre_order = relationship("PreOrder", back_populates="flows", lazy="noload")
    product = relationship("Product", lazy="selectin")
    unit = relationship("Unit", lazy="selectin")
