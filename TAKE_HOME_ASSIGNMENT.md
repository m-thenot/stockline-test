# Take-Home Assignment: Offline-First Order Recap

## Overview

Build an offline-first order management system. Sales reps use this daily to manage pre-orders from partners (customers), even with spotty internet connectivity.

**Time estimate:** 8-12 hours

---

## What You're Building

A recap page where users can manage pre-orders for a delivery date. The system must work offline and sync automatically when connectivity returns.

---

## Data Model

Four entities. All IDs are UUIDs.

```
┌─────────────┐       ┌─────────────┐
│   Partner   │       │   Product   │
├─────────────┤       ├─────────────┤
│ id          │       │ id          │
│ name        │       │ name        │
│ short_name  │       │ sku         │
└─────────────┘       └─────────────┘
       │
       │
       ▼
┌─────────────┐
│  PreOrder   │
├─────────────┤
│ id          │
│ partner_id  │
│ delivery_date
│ status      │
│ created_at  │
│ updated_at  │
└─────────────┘
       │
       │ 1:N
       ▼
┌─────────────────┐       ┌─────────────┐
│  PreOrderFlow   │──────▶│   Product   │
├─────────────────┤       └─────────────┘
│ id              │
│ pre_order_id    │
│ product_id      │
│ weight          │
│ quantity        │
│ status          │
│ updated_at      │
└─────────────────┘
```

### Status Values
- PreOrder: `pending`, `confirmed`

---

## Functional Requirements

### Recap View

Display all pre-orders for a selected delivery date, grouped by partner.

Each pre-order shows:
- Partner name
- Status (pending/confirmed)
- List of flows (line items) with product name, quantity

### Actions Required

| Action | Description |
|--------|-------------|
| **Change date** | Switch to a different delivery date |
| **Create pre-order** | New pre-order for a partner |
| **Delete pre-order** | Remove entire pre-order |
| **Change partner** | Reassign pre-order to different partner |
| **Change status** | Toggle pending ↔ confirmed |
| **Add flow** | Add line item to pre-order |
| **Remove flow** | Delete line item |
| **Change product** | Change product on a flow |
| **Change quantity** | Edit quantity on a flow |


### Offline-First Behavior

The application must:

1. **Work offline** - All actions available without internet
2. **Persist locally** - Changes survive page refresh
3. **Sync automatically** - When online, sync in background
4. **Handle conflicts** - Multiple users editing same data

### Multi-User Support

Multiple users can work on the same database simultaneously. Your solution must handle:
- Concurrent edits to the same pre-order
- Data freshness (seeing other users' changes)
- Conflict resolution strategy

---

## Technical Requirements

| Component | Requirement |
|-----------|-------------|
| Backend | Python|
| Database | PostgreSQL |
| Frontend | React, TypeScript |


---

## Seed Data

Create seed data
