import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Partner, PreOrder, PreOrderFlow, Product, Unit

# ── Deterministic UUIDs (uuid5 from names) ───────────────────────────

_NS = uuid.NAMESPACE_DNS

# Products
PRODUCT_SALMON = uuid.uuid5(_NS, "Atlantic Salmon")
PRODUCT_SEA_BASS = uuid.uuid5(_NS, "Wild Sea Bass")
PRODUCT_SEA_BREAM = uuid.uuid5(_NS, "Royal Sea Bream")
PRODUCT_TUNA = uuid.uuid5(_NS, "Bluefin Tuna")
PRODUCT_COD = uuid.uuid5(_NS, "Atlantic Cod")
PRODUCT_SHRIMP = uuid.uuid5(_NS, "Pink Shrimp")
PRODUCT_OYSTERS = uuid.uuid5(_NS, "Special Oysters")
PRODUCT_SOLE = uuid.uuid5(_NS, "Dover Sole")
PRODUCT_TURBOT = uuid.uuid5(_NS, "Turbot")
PRODUCT_LOBSTER = uuid.uuid5(_NS, "Blue Lobster")

# Partners
PARTNER_SAILOR = uuid.uuid5(_NS, "The Sailor Restaurant")
PARTNER_DUPONT = uuid.uuid5(_NS, "Dupont Fish Market")
PARTNER_ATLANTIC = uuid.uuid5(_NS, "Atlantic Hotel")
PARTNER_BRETON = uuid.uuid5(_NS, "Breton Fisheries")
PARTNER_NORTHERN = uuid.uuid5(_NS, "Northern Wholesaler")
PARTNER_LORIENT = uuid.uuid5(_NS, "Lorient Auction")

# Units
UNIT_KG = uuid.uuid5(_NS, "Kilogram")
UNIT_PCE = uuid.uuid5(_NS, "Piece")
UNIT_CRT = uuid.uuid5(_NS, "Crate")
UNIT_TRY = uuid.uuid5(_NS, "Tray")

# Pre-orders
PRE_ORDER_1 = uuid.uuid5(_NS, "PreOrder-1")
PRE_ORDER_2 = uuid.uuid5(_NS, "PreOrder-2")
PRE_ORDER_3 = uuid.uuid5(_NS, "PreOrder-3")

# Flows
FLOW_1A = uuid.uuid5(_NS, "Flow-1A")
FLOW_1B = uuid.uuid5(_NS, "Flow-1B")
FLOW_1C = uuid.uuid5(_NS, "Flow-1C")
FLOW_2A = uuid.uuid5(_NS, "Flow-2A")
FLOW_2B = uuid.uuid5(_NS, "Flow-2B")
FLOW_3A = uuid.uuid5(_NS, "Flow-3A")
FLOW_3B = uuid.uuid5(_NS, "Flow-3B")


async def seed_database(session: AsyncSession) -> None:
    """Seed the database with sample data if tables are empty."""

    # Check if products already exist
    result = await session.execute(select(Product).limit(1))
    if result.scalars().first() is not None:
        return

    today = date.today().isoformat()

    # ── Products ─────────────────────────────────────────────────────
    products = [
        Product(
            id=PRODUCT_SALMON,
            name="Atlantic Salmon",
            short_name="Salmon",
            sku="SAL001",
            code="PSAL",
        ),
        Product(
            id=PRODUCT_SEA_BASS,
            name="Wild Sea Bass",
            short_name="Sea Bass",
            sku="BAS001",
            code="PBAS",
        ),
        Product(
            id=PRODUCT_SEA_BREAM,
            name="Royal Sea Bream",
            short_name="Bream",
            sku="BRE001",
            code="PBRE",
        ),
        Product(id=PRODUCT_TUNA, name="Bluefin Tuna", short_name="Tuna", sku="TUN001", code="PTUN"),
        Product(id=PRODUCT_COD, name="Atlantic Cod", short_name="Cod", sku="COD001", code="PCOD"),
        Product(
            id=PRODUCT_SHRIMP, name="Pink Shrimp", short_name="Shrimp", sku="SHR001", code="PSHR"
        ),
        Product(
            id=PRODUCT_OYSTERS,
            name="Special Oysters",
            short_name="Oysters",
            sku="OYS001",
            code="POYS",
        ),
        Product(id=PRODUCT_SOLE, name="Dover Sole", short_name="Sole", sku="SOL001", code="PSOL"),
        Product(id=PRODUCT_TURBOT, name="Turbot", short_name="Turbot", sku="TUR001", code="PTUR"),
        Product(
            id=PRODUCT_LOBSTER, name="Blue Lobster", short_name="Lobster", sku="LOB001", code="PLOB"
        ),
    ]
    session.add_all(products)

    # ── Partners ─────────────────────────────────────────────────────
    partners = [
        Partner(id=PARTNER_SAILOR, name="The Sailor Restaurant", code="SAIL", type=1),
        Partner(id=PARTNER_DUPONT, name="Dupont Fish Market", code="DUPO", type=1),
        Partner(id=PARTNER_ATLANTIC, name="Atlantic Hotel", code="ATLA", type=1),
        Partner(id=PARTNER_BRETON, name="Breton Fisheries", code="BRET", type=2),
        Partner(id=PARTNER_NORTHERN, name="Northern Wholesaler", code="NORT", type=2),
        Partner(id=PARTNER_LORIENT, name="Lorient Auction", code="LORI", type=2),
    ]
    session.add_all(partners)

    # ── Units ────────────────────────────────────────────────────────
    units = [
        Unit(id=UNIT_KG, name="Kilogram", abbreviation="kg"),
        Unit(id=UNIT_PCE, name="Piece", abbreviation="pce"),
        Unit(id=UNIT_CRT, name="Crate", abbreviation="crt"),
        Unit(id=UNIT_TRY, name="Tray", abbreviation="try"),
    ]
    session.add_all(units)

    # ── Pre-orders ───────────────────────────────────────────────────
    pre_orders = [
        PreOrder(
            id=PRE_ORDER_1,
            partner_id=PARTNER_SAILOR,
            status=0,
            order_date=today,
            delivery_date=today,
        ),
        PreOrder(
            id=PRE_ORDER_2,
            partner_id=PARTNER_DUPONT,
            status=1,
            order_date=today,
            delivery_date=today,
        ),
        PreOrder(
            id=PRE_ORDER_3,
            partner_id=PARTNER_ATLANTIC,
            status=0,
            order_date=today,
            delivery_date=today,
        ),
    ]
    session.add_all(pre_orders)

    # ── Flows ────────────────────────────────────────────────────────
    flows = [
        # Pre-order 1: The Sailor Restaurant - 3 flows
        PreOrderFlow(
            id=FLOW_1A,
            pre_order_id=PRE_ORDER_1,
            product_id=PRODUCT_SALMON,
            quantity=5,
            price=12.50,
            unit_id=UNIT_KG,
        ),
        PreOrderFlow(
            id=FLOW_1B,
            pre_order_id=PRE_ORDER_1,
            product_id=PRODUCT_SEA_BASS,
            quantity=3,
            price=18.00,
            unit_id=UNIT_KG,
        ),
        PreOrderFlow(
            id=FLOW_1C,
            pre_order_id=PRE_ORDER_1,
            product_id=PRODUCT_SHRIMP,
            quantity=2,
            price=22.00,
            unit_id=UNIT_KG,
        ),
        # Pre-order 2: Dupont Fish Market - 2 flows
        PreOrderFlow(
            id=FLOW_2A,
            pre_order_id=PRE_ORDER_2,
            product_id=PRODUCT_TUNA,
            quantity=10,
            price=35.00,
            unit_id=UNIT_KG,
        ),
        PreOrderFlow(
            id=FLOW_2B,
            pre_order_id=PRE_ORDER_2,
            product_id=PRODUCT_COD,
            quantity=8,
            price=8.50,
            unit_id=UNIT_PCE,
        ),
        # Pre-order 3: Atlantic Hotel - 2 flows
        PreOrderFlow(
            id=FLOW_3A,
            pre_order_id=PRE_ORDER_3,
            product_id=PRODUCT_LOBSTER,
            quantity=4,
            price=45.00,
            unit_id=UNIT_PCE,
        ),
        PreOrderFlow(
            id=FLOW_3B,
            pre_order_id=PRE_ORDER_3,
            product_id=PRODUCT_OYSTERS,
            quantity=2,
            price=38.00,
            unit_id=UNIT_CRT,
        ),
    ]
    session.add_all(flows)

    await session.commit()
