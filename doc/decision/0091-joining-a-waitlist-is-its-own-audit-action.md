# 0091 – Joining a waitlist is its own audit action

**Date:** 2026-09-02 · **Status:** accepted · **Affects:** `libs/garage/contract`, `libs/garage/database`,
`apps/garage/api/src/reservations/` · **Follows on from:** `doc/decision/0016-*`, `doc/decision/0059-*`

## What

`AUDIT_LOG_ACTIONS` gains an eighth member, **`WAITLIST_JOINED`**, written whenever a user enters a
queue — by `WaitlistService.join` (one entry) and by `BulkReservationService.confirm` (up to a
month's worth at once), in the same transaction as the entry itself:

```
action: 'WAITLIST_JOINED', entityType: 'WaitlistEntry', entityId: <entry id>,
payload: { parkingSpotId, date }
```

The enum is added to the contract, to `schema.prisma`, and to the database by
`20260902120000_audit_waitlist_joined` (`ALTER TYPE … ADD VALUE IF NOT EXISTS`).

## Why

**Task 13 left a hole that Task 30 makes visible.** `WAITLIST_PROMOTED` records the moment a queue
pays off, but nothing recorded the moment somebody entered one. With single-day joins that was
survivable — one deliberate click, one row, and the entry itself is the evidence. Bulk booking
changes the arithmetic: one request can create up to 31 queue entries across every spot in the lot,
and the entries are hard-deleted on promotion or cancellation. Without this action, "why was I
behind eleven people on the 12th?" has no answer left in the database.

**A queue place is a scarce resource, and the audit log is the record of who got what.**
`doc/decision/0027-*` fixed the shape of that argument for reservations: the row can disappear, so
the log is the history. Queue position is decided by `createdAt` order; a lost entry takes its
position with it.

**Extending the enum is additive and cheap here.** `doc/decision/0016-*` treats `AUDIT_LOG_ACTIONS`
as a closed list precisely so that additions are deliberate — and `doc/decision/0059-*` already
established the precedent (`RESERVATION_WINDOW_UPDATED`) that a distinct, auditable event gets its
own member rather than being folded into a neighbour's payload. Unlike `ERROR_CODES`, this enum has
no user-facing Czech copy hanging off it, so the blast radius is the schema, the parity spec and one
migration.

**Why not reuse `WAITLIST_PROMOTED` with a payload discriminator.** It would make every existing
query for "promotions" wrong unless it also filtered on the payload, and the two events mean
opposite things: one is a request, the other is a grant.

## How

- `libs/garage/contract/src/schemas/entities.ts` — the member, last in the tuple; `entities.spec.ts`
  asserts the exact membership, so schema and contract cannot drift apart silently.
- `libs/garage/database/prisma/schema.prisma` + the migration above. `ADD VALUE IF NOT EXISTS` keeps the
  migration re-runnable; `schema-contract-parity.spec.ts` fails if either side forgets.
- `AuditLogService.recordMany` — added for the bulk path, which would otherwise issue one `INSERT`
  per day inside an already long transaction. It takes the same optional transaction client as
  `record`, so the entries are written by the transaction that created the rows they describe.
- `waitlist.db.spec.ts` ("queues the caller and reports their position") asserts the actor, entity
  and payload of both joins; `bulk-reservation.db.spec.ts` ("queues, audits and broadcasts when the
  whole lot is taken") asserts the same for the bulk path.

## Risk

**An enum value cannot be removed from PostgreSQL.** `ALTER TYPE … ADD VALUE` is one-way short of a
type rewrite. Accepted: that is true of every member already there, and it is the reason the list is
closed and each addition gets a record.

**Volume.** A bulk confirmation on a full lot writes up to 31 audit rows for one click, on top of
the entries. The table is append-only and indexed on `createdAt` and `(entityType, entityId)`; at
this population (single office, tens of spots) the cost is noise. If it ever stops being noise, the
answer is retention on `AuditLog`, not a quieter action list.
