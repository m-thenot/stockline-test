# Frontend — Next.js 15 + React 19

Single-page app for managing pre-orders, built with TanStack Query and shadcn/ui.

## Structure

```
frontend/
├── Dockerfile
├── package.json             # Dependencies (next, react, tanstack-query, tailwind v4, radix, date-fns)
├── tsconfig.json            # Strict TS, path alias @/* → ./src/*
├── next.config.ts
├── postcss.config.mjs       # Tailwind CSS v4 via @tailwindcss/postcss
└── src/
    ├── lib/
    │   ├── api.ts           # Fetch wrapper + all API endpoints
    │   ├── types.ts         # TypeScript interfaces matching backend schemas
    │   └── utils.ts         # cn() helper (clsx + tailwind-merge)
    ├── hooks/
    │   ├── use-recap.ts     # Main hook: recap query + all 6 CRUD mutations
    │   ├── use-products.ts  # useQuery for products list
    │   ├── use-partners.ts  # useQuery for partners list
    │   └── use-units.ts     # useQuery for units list
    ├── components/
    │   ├── ui/              # shadcn/ui primitives (button, card, dialog, select, badge, etc.)
    │   ├── layout/
    │   │   └── sidebar.tsx  # Navigation sidebar (Dashboard, Recap, Products, Partners)
    │   └── recap/
    │       ├── recap-view.tsx       # Page container: date picker + partner groups
    │       ├── partner-card.tsx     # Collapsible partner group with order count badge
    │       ├── order-card.tsx       # Order card: status toggle, delete, flow list
    │       ├── flow-row.tsx         # Editable flow line (debounced updates, 500ms)
    │       ├── add-flow-form.tsx    # Inline form to add a flow to an order
    │       ├── add-order-dialog.tsx # Dialog to create a new pre-order
    │       └── date-picker.tsx      # Calendar date picker (react-day-picker)
    └── app/
        ├── layout.tsx       # Root layout with sidebar
        ├── providers.tsx    # QueryClientProvider (refetchOnWindowFocus: false, retry: 1)
        ├── globals.css      # Tailwind imports + CSS variables
        ├── page.tsx         # Dashboard (placeholder)
        ├── recap/page.tsx   # Recap page (main feature)
        ├── products/page.tsx    # Read-only product list
        └── partners/page.tsx    # Read-only partner list
```

## Data Flow

```
API (backend)
  ↕ fetch (src/lib/api.ts)
TanStack Query (src/hooks/)
  ↕ query data + mutation functions
Components (src/components/recap/)
```

**Read path**: `useRecap(date)` calls `api.getRecap(date)` → returns `RecapGroup[]` (partner + pre-orders + flows).

**Write path**: Each mutation (create/update/delete for orders and flows) calls the API then invalidates the `["recap", date]` query to refetch.

## Key Patterns

- **All state is server state** — no local React state for data, everything goes through TanStack Query.
- **Debounced updates** — `flow-row.tsx` debounces quantity/price/comment edits (500ms) to avoid excessive API calls. Product and unit changes fire immediately.
- **Nested component hierarchy** — RecapView → PartnerCard → OrderCard → FlowRow. Each level receives mutations from the shared `useRecap` hook.
- **Immediate API calls** — every user action triggers a network request. There is no offline support (this is the challenge).

## Types

All interfaces are in `src/lib/types.ts` and mirror the backend Pydantic schemas:

| Type | Key Fields |
|------|------------|
| `Product` | id, name, short_name, sku, code |
| `Partner` | id, name, code, type (1=client, 2=supplier) |
| `Unit` | id, name, abbreviation |
| `PreOrder` | id, partner_id, status (0/1), delivery_date, flows[] |
| `PreOrderFlow` | id, pre_order_id, product_id, quantity, price, unit_id |
| `RecapGroup` | partner + pre_orders[] |

## Running Locally

```bash
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

App at [http://localhost:3000](http://localhost:3000). Requires the backend running on port 8000.
