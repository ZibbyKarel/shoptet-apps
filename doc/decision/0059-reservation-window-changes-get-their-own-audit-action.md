# 0059 – A reservation-window change gets its own audit action

**Date:** 2026-09-02 · **Status:** accepted · **Follows on from:** `doc/decision/0026-*`

## What

`AUDIT_LOG_ACTIONS` in `libs/garage/contract/src/schemas/entities.ts` and `enum AuditLogAction` in
`libs/garage/database/prisma/schema.prisma` gained one member: **`RESERVATION_WINDOW_UPDATED`**.
Migration `20260902090000_audit_reservation_window_updated` adds it to the Postgres type with
`ALTER TYPE … ADD VALUE IF NOT EXISTS`.

`ReservationWindowService.updateSettings` writes one entry under it, with the entity type
`ReservationWindowSettings`, the entity id `'1'` (the singleton's fixed id), and a payload
holding both `{ openDaysBefore, lockMode }` before and after.

This is a **contract change**, made deliberately rather than worked around, as the task
constraints require. It is additive: no existing member changed meaning, and no existing row
becomes invalid.

## Why

**The existing members do not cover it.** The enum described actions on reservations, waitlist
entries, spots and users. A window change is none of those — and reusing the nearest member
(`SPOT_UPDATED`, say) would make `entityType` the only thing distinguishing two unrelated events,
which defeats the point of having a closed enum the admin UI can filter on.

**Why this write is audited at all.** `openDaysBefore` and `lockMode` are two integers-worth of
state that decide, for **every** user, whether a month can be booked. When somebody cannot
reserve a day they expected to, the first question is "did an admin close it, and when?" — and
the settings row cannot answer that: it is a singleton that is updated in place, so it holds only
the current values. The audit entry is the only record that the previous values ever existed.
That is why the payload carries both sides rather than just the new one.

**Why `entityId` is a string `'1'`.** `AuditLog.entityId` is a `String` column, because the other
audited entities are identified by UUID. The window settings row is identified by the integer
`1`, fixed by a `CHECK ("id" = 1)` constraint (`doc/decision/0026-*`). Stringifying the constant
keeps one column type for all entity kinds; inventing a nullable integer column beside it, or a
sentinel UUID for a row that does not have one, would both be worse.

## Consequences

- A deployment applying this migration must run it before any code that writes the new action —
  ordinary migration ordering, but worth stating because Postgres enum values added inside a
  transaction cannot be used in that same transaction.
- The admin audit view (a later task) gets a fourth entity type to render. `entityType` is a plain
  string in the contract, so nothing else has to change for it.
- `libs/garage/contract/src/schemas/entities.spec.ts` asserts the enum's exact membership, so the next
  addition is a deliberate edit in two places plus a migration — which is the intended friction.
