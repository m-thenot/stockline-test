from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import AsyncSessionLocal, Base, engine
from .seed import seed_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Seed data
    async with AsyncSessionLocal() as session:
        await seed_database(session)
    yield


app = FastAPI(title="Interview Test API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
from .routes import flows, partners, pre_orders, products, units  # noqa: E402

app.include_router(products.router, tags=["Products"])
app.include_router(partners.router, tags=["Partners"])
app.include_router(units.router, tags=["Units"])
app.include_router(pre_orders.router, tags=["Pre-Orders"])
app.include_router(flows.router, tags=["Flows"])


@app.get("/health")
async def health():
    return {"status": "ok"}
