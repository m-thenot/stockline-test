# Backend — FastAPI + SQLAlchemy

Async Python API for managing pre-orders in a fish/seafood wholesale context.

## Structure

```
backend/
├── Dockerfile
├── pyproject.toml          # Dependencies (fastapi, sqlalchemy, asyncpg, uvicorn)
└── app/
    ├── main.py             # FastAPI app, lifespan (create tables + seed), CORS, router includes
    ├── database.py         # Async SQLAlchemy engine, session factory, Base class
    ├── models.py           # 5 ORM models (see below)
    ├── schemas.py          # Pydantic request/response schemas
    ├── seed.py             # Deterministic seed data (products, partners, units, sample orders)
    └── routes/
        ├── products.py     # GET /products
        ├── partners.py     # GET /partners
        ├── units.py        # GET /units
        ├── pre_orders.py   # CRUD /pre-orders + GET /pre-orders/recap/{date}
        └── flows.py        # CRUD /flows (line items within an order)
```

## Data Model

```
Product           Partner            Unit
├── id (UUID)     ├── id (UUID)      ├── id (UUID)
├── name          ├── name           ├── name
├── short_name    ├── code           └── abbreviation
├── sku           └── type (1=client, 2=supplier)
└── code

PreOrder                          PreOrderFlow
├── id (UUID)                     ├── id (UUID)
├── partner_id → Partner          ├── pre_order_id → PreOrder (cascade delete)
├── status (0=pending, 1=confirmed) ├── product_id → Product
├── order_date (YYYY-MM-DD)       ├── quantity (float)
├── delivery_date (YYYY-MM-DD)    ├── price (float)
├── comment                       ├── unit_id → Unit
├── created_at                    ├── comment
└── updated_at                    ├── created_at
                                  └── updated_at
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/products` | List all products |
| GET | `/partners` | List all partners |
| GET | `/units` | List all units |
| GET | `/pre-orders/recap/{date}` | Pre-orders for a date, grouped by partner |
| POST | `/pre-orders` | Create a pre-order |
| PUT | `/pre-orders/{id}` | Update a pre-order (partial) |
| DELETE | `/pre-orders/{id}` | Delete a pre-order (cascades to flows) |
| POST | `/pre-orders/{pre_order_id}/flows` | Add a flow line to an order |
| PUT | `/flows/{id}` | Update a flow (partial) |
| DELETE | `/flows/{id}` | Delete a flow |

The recap endpoint returns `RecapPartnerGroup[]` — each group contains a `partner` and their `pre_orders` (with nested `flows`).

## Key Behaviors

- **Auto-setup on startup**: Tables are created and seed data is inserted via the FastAPI lifespan hook. No migrations needed.
- **Deterministic seed IDs**: Uses `uuid5` so IDs are stable across restarts (won't duplicate data).
- **Eager loading**: PreOrder loads `partner` and `flows` via `selectin`; flows load `product` and `unit`. No N+1 issues.
- **Cascade delete**: Deleting a PreOrder automatically deletes its flows.
- **Partial updates**: PUT endpoints use `exclude_unset=True` — only provided fields are updated.
- **CORS**: Wide open (`*`) for local dev.

## Seed Data

- 10 products (Salmon, Sea Bass, Tuna, Cod, Shrimp, etc.)
- 6 partners (3 clients, 3 suppliers)
- 4 units (kg, piece, crate, tray)
- 3 pre-orders with 7 flows (seeded for today's date)

## Running Locally

```bash
uv sync
DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5433/interview_db" \
  uv run uvicorn app.main:app --port 8000 --reload
```

Interactive API docs at [http://localhost:8000/docs](http://localhost:8000/docs).
