# Stockline Interview Test

A simplified business management app for managing pre-orders (fish/seafood wholesale). Built with FastAPI + Next.js.

## Prerequisites

Before you start, make sure you have the following installed on your machine:

### Docker

Docker runs the database (PostgreSQL). You don't need to install PostgreSQL yourself.

- **Mac**: Download [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) and install it. Open the app once to finish setup. Verify with:
  ```bash
  docker --version
  docker compose version
  ```

### Node.js (v20+)

Node.js runs the frontend (Next.js / React).

- **Recommended**: Install via [nvm](https://github.com/nvm-sh/nvm) (Node Version Manager):
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  # Restart your terminal, then:
  nvm install 20
  nvm use 20
  ```
- **Alternative**: Download directly from [nodejs.org](https://nodejs.org/) (pick the LTS version)
- Verify: `node --version` should show v20 or higher

### uv (Python package manager)

uv manages the backend Python dependencies. It's fast and handles everything (Python version, virtualenv, packages).

- **Install**:
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```
- Restart your terminal after installing
- Verify: `uv --version`
- uv will automatically download the right Python version when you first run `uv sync` — no need to install Python separately

## Setup

### 1. Start the database

This starts PostgreSQL and Adminer (a database admin UI) in Docker:

```bash
docker compose up -d db adminer
```

Wait a few seconds for PostgreSQL to be ready. You can check with:
```bash
docker compose ps
# db should show "healthy" in the STATUS column
```

### 2. Start the backend

Open a terminal and run:

```bash
cd backend
uv sync
DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5433/interview_db" uv run uvicorn app.main:app --port 8000 --reload
```

`uv sync` installs Python dependencies (first run only — takes ~10 seconds).

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Started reloader process
```

The backend automatically creates database tables and seeds sample data on first startup.

### 3. Start the frontend

Open a **new terminal** and run:

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

`npm install` downloads JavaScript dependencies (first run only — takes ~20 seconds).

You should see:
```
▲ Next.js 15.x (Turbopack)
- Local: http://localhost:3000
✓ Ready
```

### 4. Open the app

- **App**: [http://localhost:3000](http://localhost:3000) — the main application
- **API docs**: [http://localhost:8000/docs](http://localhost:8000/docs) — interactive API documentation (try endpoints here)
- **Database admin**: [http://localhost:8080](http://localhost:8080) — browse database tables directly
  - System: PostgreSQL
  - Server: `db`
  - Username: `postgres`
  - Password: `postgres`
  - Database: `interview_db`

## Architecture

### Backend (FastAPI + SQLAlchemy)

Python async API. See [backend/README.md](./backend/README.md) for details.

- **5 models**: Product, Partner, Unit, PreOrder, PreOrderFlow
- **RESTful API**: Standard CRUD operations
- **Auto-seed**: Tables are created and seeded on startup (10 products, 6 partners, 4 units, sample orders)
- **No auth**: Simplified for the interview context

### Frontend (Next.js 15 + React 19)

React single-page app. See [frontend/README.md](./frontend/README.md) for details.

- **TanStack Query**: Data fetching and cache management
- **shadcn/ui**: Component library (Button, Card, Dialog, Select, etc.)
- **Tailwind CSS v4**: Utility-first styling
- **3 pages**: Products (read-only), Partners (read-only), Recap (full CRUD)

### Key page: Recap (`/recap`)

The recap page shows pre-orders for a given delivery date, grouped by partner. You can:
- Navigate dates with the date picker
- Create/delete pre-orders
- Toggle order status (pending / confirmed)
- Add/edit/delete flow lines (product, quantity, unit, price)

**Every action makes an immediate API call.** There is no offline support — this is intentional (see the challenge).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/products` | List all products |
| GET | `/partners` | List all partners |
| GET | `/units` | List all units |
| GET | `/pre-orders/recap/{date}` | Get recap for a date (grouped by partner) |
| POST | `/pre-orders` | Create pre-order |
| PUT | `/pre-orders/{id}` | Update pre-order (partial) |
| DELETE | `/pre-orders/{id}` | Delete pre-order (cascades to flows) |
| POST | `/pre-orders/{pre_order_id}/flows` | Add flow to order |
| PUT | `/flows/{id}` | Update flow (partial) |
| DELETE | `/flows/{id}` | Delete flow |

All IDs are UUIDs. PUT endpoints accept partial updates (only send the fields you want to change).

Browse the interactive docs at [http://localhost:8000/docs](http://localhost:8000/docs) to try these out.

## Day-to-day Development

Both backend and frontend **auto-reload** when you save a file — no need to restart anything.

- **Backend**: Edit files in `backend/app/` → uvicorn detects changes and reloads
- **Frontend**: Edit files in `frontend/src/` → Next.js hot-reloads in the browser

### Reset the database

If you want to start fresh (wipes all data, re-seeds on next backend start):

```bash
docker compose down -v        # Stop and delete database volume
docker compose up -d db adminer  # Start fresh
# Restart the backend — it will recreate tables and seed data
```

### Stop everything

```bash
# Stop the database
docker compose down

# Stop backend/frontend: Ctrl+C in their terminal windows
```

## Troubleshooting

**Port already in use**: If port 3000, 8000, or 5433 is busy, either stop the other process or change the port:
```bash
# Frontend on a different port
PORT=3001 npm run dev

# Backend on a different port
DATABASE_URL="..." uv run uvicorn app.main:app --port 8001 --reload
```

**Docker not running**: If `docker compose up` fails, make sure Docker Desktop is open and running.

**Database connection refused**: Wait a few seconds after `docker compose up` — PostgreSQL needs time to initialize. Check with `docker compose ps` (status should be "healthy").

**`uv: command not found`**: Restart your terminal after installing uv, or run `source ~/.bashrc` (or `~/.zshrc`).

**`node: command not found`**: Restart your terminal after installing Node.js via nvm, or run `source ~/.bashrc` (or `~/.zshrc`).

## Challenge

See [CHALLENGE.md](./CHALLENGE.md) for the interview challenge.
