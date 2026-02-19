# Architecture Decisions - Offline-First Sync Engine

---

## Overview

This project implements an offline-first synchronization engine for a collaborative pre-order management application. It is based on common patterns such as the Outbox pattern for queuing local operations, optimistic versioning for conflict detection, and a simple Last-Write-Wins (LWW) strategy for automatic resolution.

The server acts as the source of truth, while clients synchronize through HTTP push/pull endpoints and receive live updates via Server-Sent Events. Soft deletes are used to preserve history, and the sync logic handles rebasing when versions diverge. The project includes unit tests for the core services and basic end-to-end tests.

---

## Core Architecture

### 1. Three-Layer Sync Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Server (PostgreSQL)                  │
│  - Source of truth                                  │
│  - Handles conflicts   │
│  - Broadcasts changes via SSE                       │
└─────────────────┬───────────────────────────────────┘
                  │
                  │ HTTP (Push/Pull)
                  │ SSE (Real-time events)
                  │
┌─────────────────▼───────────────────────────────────┐
│              SyncManager (Frontend)                 │
│  - PushService: Sends local changes to server       │
│  - PullService: Fetches server changes              │
│  - Conflict resolution & rebase logic               │
└─────────────────┬───────────────────────────────────┘
                  │
                  │ IndexedDB Operations
                  │
┌─────────────────▼───────────────────────────────────┐
│           IndexedDB (Dexie.js)                      │
│  - Local database (offline persistence)             │
│  - Outbox table (pending operations)                │
│  - Entity tables with versions                      │
└─────────────────────────────────────────────────────┘
```

### 2. Outbox Pattern

All local modifications (CREATE/UPDATE/DELETE) are stored in an **Outbox** table before being sent to the server.

**Benefits:**

- Works offline (queue operations)
- Retry on network failure (exponential backoff)
- Preserves operation order (sequence_number)
- Transaction-like guarantees (all or nothing)

### 3. Optimistic Locking (Versioning)

Each entity has a `version` field (integer) that increments on every update.

**Conflict Detection:**

```
Client sends: expected_version = 5
Server has: actual_version = 7
```

**Resolution Strategy:**

- Same field modified: **Server wins**
- Different fields modified: **Merge** (both changes accepted)
- DELETE vs UPDATE: **DELETE wins** (entity removed)

### 4. Push/Pull Sync Cycle

**Push (PushService):**

1. Get all pending operations from Outbox
2. Coalesce redundant operations (e.g., CREATE + UPDATE → single CREATE)
3. Batch send to `POST /sync/push`
4. Handle per-operation results (success/conflict/rejected)
5. Update entity versions in IndexedDB
6. Mark operations as synced/rejected

**Pull (PullService):**

1. Fetch operations from server since `last_sync_id`
2. Check for conflicts with local pending operations
3. **Rebase** if conflicts: apply server changes, then reapply local changes
4. Update IndexedDB
5. Invalidate React Query cache

### 5. Real-Time Collaboration (SSE)

The server broadcasts change events via **Server-Sent Events (SSE)**.

**Event Types:**

- `sync`: Entity changed (create/update/delete)
- `ping`: Keepalive (every 30s)

**Client Flow:**

```
Server sends SSE event
  ↓
SSEService receives event
  ↓
SyncManager debounces (100ms)
  ↓
PullService.pullIncremental()
  ↓
IndexedDB updated
  ↓
React Query cache invalidated
  ↓
UI re-renders with new data
```

---

## Technical Choices

### 1. Last-Write-Wins (LWW) on Conflicts

**Decision:** When two clients modify the same field, the first write to reach the server wins. The second client receives a conflict and accepts the server's value.

**How it works:**

```
Time T0: Both clients have entity with version=1, status=0
Time T1: Client A modifies status=1 (offline)
Time T2: Client B modifies status=2, pushes immediately → Server accepts (version=2)
Time T3: Client A comes online, pushes status=1 with expected_version=1
         → Server detects conflict (actual_version=2)
         → Server returns conflict with winner="server", server_value=2
         → Client A accepts status=2 (LWW: Client B won)
```

**Why:**

- Simple and predictable behavior
- Works well for collaborative editing with network delays
- Deterministic (timestamp-based ordering on server)

**Trade-off:**

- ⚠️ Second writer loses their changes (if fields overlap)
- ⚠️ Need UI notification to inform user (not implemented yet)
- ✅ Different fields are merged (both changes accepted)

**Alternative considered:**

- CRDT (rejected: overkill for this use case, more suitable for fully decentralized architectures)
- OT (Operational Transformation) (more appropriate for real-time collaborative text editing, not well suited for this type of structured business data)

### 2. Optimistic Locking (Versions) Instead of Timestamps

**Decision:** Use integer versions instead of `updated_at` timestamps.

**Why:**

- Immune to clock drift (server/client time mismatch)
- Easier to reason about (sequential)
- Natural ordering for operations

**Trade-off:**

- ⚠️ Need to track versions in IndexedDB

### 3. Outbox Table for Pending Operations

**Decision:** Store pending operations in a separate table instead of marking entities as "dirty".

**Why:**

- Supports DELETE operations (entity doesn't exist anymore)
- Preserves operation order (critical for consistency)
- Allows retry logic with backoff
- Can coalesce redundant operations

**Trade-off:**

- ⚠️ More storage overhead (outbox entries)
- ⚠️ Need garbage collection (not implemented)

### 4. SSE Instead of WebSockets

**Decision:** Use Server-Sent Events for real-time updates instead of WebSockets.

**Why:**

- Simpler server implementation (HTTP-based)
- Auto-reconnect built-in (EventSource API)
- One-way communication is enough (server → client)

**Trade-off:**

- ⚠️ Can't push from client (need HTTP requests anyway)
- ⚠️ Another pull request is needed to get the actual data

### 6. React Query Instead of MobX or Other State Stores

**Decision:** Use TanStack Query (React Query) for client state management instead of MobX, Zustand, or Redux.

**Why:**

- Simple implementation (single library for all data fetching needs)
- Works well with other pages that need live queries (without IndexedDB)
- Built-in cache invalidation mechanism (good enough for MVP)
- Low complexity (no store setup, no normalization boilerplate)
- Good integration with React hooks

**Trade-off:**

- ⚠️ Requires manual cache invalidation (via `QueryInvalidator`)
- ⚠️ Current implementation is not optimal: `useRecap` returns a single monolithic joined query
- ⚠️ Should be refactored into **normalized caches** (separate queries for partners, products, units, pre_orders, flows) composed into a derived view
- ⚠️ Harder to track granular mutations (MobX observables would be more explicit)

### 7. Soft Delete with `deleted_at`

**Decision:** Mark entities as deleted with a `deleted_at` timestamp instead of hard deletes.

**Why:**

- Preserves history (can restore accidentally deleted data)
- Enables audit trail (track who deleted what and when)
- Simplifies sync logic (entity still exists in DB, just marked as deleted)
- Supports undo operations

**Trade-off:**

- ⚠️ Database grows over time (need periodic archiving/cleanup)
- ⚠️ All queries must filter `WHERE deleted_at IS NULL`

### 8. UUIDv7

**Decision:** Use UUIDv7 (time-ordered UUIDs) for all entity identifiers instead of auto-increment integers or random UUIDs.

**Why:**

- Time-ordered (sortable by creation time)
- Globally unique (safe for offline creation without coordination)
- Better database indexing performance than UUIDv4 (reduced fragmentation)
- Natural ordering for operations (helpful for debugging)

**Trade-off:**

- ⚠️ Slightly larger than integers (16 bytes vs 4-8 bytes)
- ⚠️ Less human-readable than sequential integers

---

## What's Missing & Future Improvements

### Critical Gaps

- **Conflict notifications:** Users unaware when LWW overwrites their changes (silent data loss)
- **E2E test coverage:** Only basic scenarios tested, need concurrency/conflict/network edge cases
- **Garbage collection:** Outbox grows indefinitely, no cleanup for old synced operations

### UX & Performance

- **Recap page UX**: The recap page UX would need a full redesign. Inline editing is not well suited for touch interactions (small inputs, no tolerance for imprecise taps). The overall hierarchy and search experience for orders or partners should also be reconsidered. From a business perspective, it’s worth questioning whether multiple orders for the same client on the same day are necessary — merging them could significantly simplify the interface. For editing flows, a side panel or bottom sheet might be more appropriate than inline inputs.
- **Initial snapshot:** Full DB fetch could be slow (MBs payload), needs streaming/pagination
- **Large datasets:** No virtualization, search, or pagination (poor performance with 100+ entities)
- **Visual feedback:** No loading states, sync indicators, or retry UI for failed operations
- Coalesce pull operations in the sync engine queue (keep only the most recent one)

### Infrastructure

- **Test database:** E2E tests pollute dev environment, need isolated test.db with seed data
- **Normalized caches:** `useRecap` is monolithic joined query, should be separate entity queries
- **Offline PWA with service worker** for caching assets

### Code

⚠️ Some parts of the code were implemented quickly and would benefit from refactoring and simplification, particularly the frontend services connected to the sync engine. React performance optimization was not a focus at this stage, and improvements could also be made in that area.

---
