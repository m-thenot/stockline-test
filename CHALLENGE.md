# Challenge: Offline-First Sync Engine

## Context

Stockline is used in fish markets, warehouses, and delivery trucks — places where internet connectivity is unreliable or absent. The recap page is the most critical part of the app: sales teams use it to manage daily pre-orders while moving between locations.

**The reality of our users:**
- They work in environments with **bad or no connectivity** (cold rooms, markets, trucks)
- They're used to **on-premise software** that just works — no loading spinners, no "connection lost" errors
- **Multiple users** edit orders simultaneously (e.g., two salespeople handling orders for the same delivery date)
- Speed matters — in the field, they need to create and modify orders instantly, not wait for network round-trips

Currently, **every action on the recap page requires an API call**. If the network drops, the app becomes unusable. This is the core problem.

## What is a Sync Engine?

A sync engine decouples the UI from the network. Instead of `UI → API → Database`, it works like:

```
UI → Local Store (IndexedDB) → Sync Engine → API → Database
                                    ↕
                              Change Queue
```

The user always reads from and writes to a local store. A background sync engine handles pushing changes to the server and pulling remote changes — resolving conflicts when they arise.

This is the architecture behind tools like **Linear**, **Figma**, and **Notion** — apps that feel instant regardless of network conditions.

**Key references to study:**
- [Linear's sync engine](https://linear.app/blog/scaling-the-linear-sync-engine) — IDB + operation log
- [Figma's multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) — CRDTs and operational transforms
- [MobX](https://mobx.js.org/) — reactive local state that could feed a sync layer
- [TanStack Query offline](https://tanstack.com/query/latest/docs/framework/react/guides/offline) — built-in mutation pausing and persistence

## Your Mission

Build a sync engine that makes the app work offline, sync automatically, and handle real-world edge cases.

## Requirements

### 1. Core — Sync Engine (Main Task)

This is the heart of the challenge.

1. **Local-first data**: All reads come from a local store (IndexedDB). The UI never waits for the network.
2. **Offline CRUD**: All operations (create/update/delete orders and flows) work without connectivity.
3. **Change queue**: Mutations are queued locally and synced to the server when online.
4. **Auto-sync**: Pending changes sync automatically when connectivity returns.
5. **Conflict handling**: Handle concurrent edits — the same record modified by two users, or locally + on server.
6. **Sync status UI**: Users can see what's synced, what's pending, and what failed.

**Architecture hint**: consider a local IndexedDB store + a change/operation queue. Each mutation is recorded as an operation (create/update/delete + entity + payload). The sync engine processes this queue in order, handles failures, and reconciles server state.

### 2. UI/UX — Polish & Performance

The current UI is functional but basic. 

- **Design & aesthetics**: Make it feel like a professional tool. Better spacing, typography, visual hierarchy.
- **Better editing UX**: The pre-order editing experience can be greatly improved — better input interactions, smarter inline editing, keyboard navigation, etc.
- **Better dialogs & forms**: Feel free to reimagine the UI as you see fit — redesign dialogs, rethink flows, improve how users interact with the app.
- **Smooth interactions**: No flickering, no layout shifts, no janky transitions.
- **Handles scale**: The recap page may have dozens of partners with hundreds of orders and many products. Ensure it performs well with large datasets (virtualization, memoization, avoiding unnecessary re-renders).
- **Loading & empty states**: Proper skeletons, meaningful empty states, clear error messages.

### 3. Data Layer — Caching & Optimization

- **Smart caching**: Use TanStack Query effectively — stale times, cache invalidation, background refetching.
- **Reactive updates across entities**: If a product is updated (e.g., name changes), that change must reflect everywhere — including inside pre-orders that reference it, even though the pre-order itself wasn't modified. This is a key test of your data layer design.
- **Optimistic updates**: UI reflects changes immediately, rolls back on failure.

### 4. New Features

Extend the app with:

- **Product management**: Create, edit, delete products (with sync engine support).
- **Partner management**: Create, edit, delete partners (with sync engine support).

**Bonus (optional):** Handle entities created offline with temporary IDs — ensure they sync correctly and that all references update (e.g., a pre-order referencing a locally-created product resolves to the server-assigned ID after sync).

## Edge Cases to Consider

These are some things that should be taken into consideration :

- **Concurrent updates**: Two users modify the same order simultaneously. What happens?
- **Delete conflicts**: User A deletes an order that User B just edited offline. How do you handle it?
- **Creation with references**: User creates a new product offline, then creates a flow referencing it. Both sync later — does the reference resolve correctly?
- **Ordering**: If a user creates an order then deletes it offline, the sync queue must respect operation order.
- **Flickering**: When syncing, the UI shouldn't flash if updates come in an order that rolls back.
- **Race conditions**: Two rapid mutations on the same field — only the last one should win.
- **Stale data**: After being offline for hours, how do you reconcile with a server that has diverged significantly?

## Testing

A sync engine is only as good as its test coverage. Consider:

- **Testing environment**: Set up a way to test offline behavior systematically — not just DevTools toggle.
- **Network simulation middleware**: A simple approach is a middleware/wrapper around the API client that can simulate latency, intermittent failures, and full offline mode programmatically.
- **E2E scenarios**: Test complex sequences, with precise timings, from multiple users.
- **Conflict scenarios**: Test concurrent edits, delete-after-edit, create-with-offline-references.

This can be as simple as a `NetworkSimulator` class or as thorough as a Playwright test suite. Show us how you think about testing complex async behavior.

## Ideas to Explore

You don't need to implement all of these, but we'd love to see your thinking:

- **WebSockets / Server-Sent Events**: For real-time sync between multiple users (push instead of poll).
- **Redis pub/sub**: Server-side change notifications for multi-user scenarios.
- **Operation log / event sourcing**: Instead of syncing state, sync operations — more robust for conflict resolution.
- **CRDT-inspired structures**: For automatic conflict-free merging.
- **Service Worker**: For true offline capability (cache API responses, intercept network requests).
- **Batch sync**: Group multiple pending operations into a single request for efficiency.
- **Exponential backoff**: Smart retry logic for failed syncs.

## Evaluation

The sync engine is the main focus — it's the hardest and most interesting part. But if it feels too ambitious, that's okay. Do your best, showcase your skills, and manage your time wisely.

There are no precise expectations. What matters is **how** you did it, **why**, and the reasoning behind your choices. A well-justified simple approach beats a complex one you can't explain. Every part of your work will be valued — the sync engine, UI improvements, testing, architecture decisions, or anything else you choose to tackle.

You are free to take any initiative not mentioned here if it seems relevant. Enjoy the challenge, explore, be creative — this will be greatly valued.

- There is no strict time limit — we value quality and depth of thinking over speed
- Time available and experience level will be taken into consideration
- Add a brief `DECISIONS.md` explaining your choices, trade-offs, and what you'd do with more time

## Submission

When done, ensure:
- The app starts correctly (see main README for setup)
- The app functions normally when online
- The recap page works when you disable network (DevTools → Network → Offline)
- Pending changes sync when you re-enable network
