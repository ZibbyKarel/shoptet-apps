# 0027 – Hard delete + an append-only `AuditLog`, instead of soft delete

**Date:** 2026-08-28 · **Status:** accepted · **Affects:** Tasks 13, 27, 30

## What

- Cancelling a reservation or leaving the waitlist **deletes the row** and
  writes a record into `AuditLog`. No table has a `deletedAt` column.
- Users and parking spots are **never deleted** – they're deactivated
  (`active = false`).
- `AuditLog` is **append-only**, enforced by a database trigger:

  ```sql
  CREATE OR REPLACE FUNCTION "auditlog_reject_mutation"() RETURNS TRIGGER AS $$
  BEGIN
    RAISE EXCEPTION 'AuditLog is append-only: % is not allowed', TG_OP
      USING ERRCODE = 'restrict_violation';
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER "AuditLog_append_only"
    BEFORE UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION "auditlog_reject_mutation"();

  CREATE TRIGGER "AuditLog_append_only_truncate"
    BEFORE TRUNCATE ON "AuditLog"
    FOR EACH STATEMENT EXECUTE FUNCTION "auditlog_reject_mutation"();
  ```

  The statement-level trigger on `TRUNCATE` is necessary: row-level triggers do
  not fire for `TRUNCATE`, so without it a single `TRUNCATE "AuditLog";` would
  bypass the whole append-only protection.

- Every other foreign key uses `ON DELETE RESTRICT`; the only `SET NULL` is
  `User.preferredParkingSpotId`.

## Why

**Soft delete would break the unique index the entire reservation logic
stands on.** `Reservation (parkingSpotId, date)` is the only thing that
prevents a double booking under concurrent requests. With soft delete, a
"cancelled" row would remain in the table, and the index would then block
anyone else from taking that spot on that day. This can be worked around with
a partial index (`WHERE "deletedAt" IS NULL`), but that turns a simple
database guarantee into something every query has to remember — and
something someone eventually forgets.

**Soft delete would clutter every query.** "Who's parking today", "how many
spots are free", "who's next on the waitlist" – all of it asks about live
records. One forgotten `WHERE "deletedAt" IS NULL` in a join or aggregate
doesn't crash, it silently produces a wrong number.

**We need the history somewhere else anyway.** The audit trail must answer
"who, what, when, and with what payload" even for actions that delete no row
at all (`USER_UPDATED`, `SPOT_UPDATED`, `WAITLIST_PROMOTED`). `AuditLog`
covers all of that; soft delete would only cover deletions, meaning a second,
partial history would be maintained alongside the audit log — and the two
would eventually drift apart.

**Deletion is safe only where it's actually happening.** Hard delete applies
exclusively to reservations and waitlist entries: short-lived records bounded
by a date, with nothing else hanging off them. Users and spots are never
deleted, because the audit log's foreign keys point at them – hence
`ON DELETE RESTRICT` everywhere, and `active = false` as the way to leave the
system.

**Why a trigger, not just a convention.** If the audit log is the only record
that a reservation ever existed, then an accidental `UPDATE` destroys evidence
that has nowhere to be restored from. The table is also reachable outside the
application (`psql`, Adminer, a migration), so "the service layer doesn't do
that" guarantees nothing. A trigger stops it in every case and costs one
function.

Prisma has no way to express append-only, so the trigger is hand-appended to
the end of the init migration – it's subject to the same `migrate dev` trap
as the `CHECK` constraints (see `doc/decision/0026-*` and `doc/database.md`).

## How

- The trigger and its function live in
  `libs/garage/database/prisma/migrations/*/migration.sql`; `migration-sql.spec.ts`
  asserts their presence.
- The service layer (Task 13) must perform the deletion and the audit write
  **in a single transaction**, or you end up with either a reservation with no
  trace, or a trace with no reservation behind it.
- `AuditLog.actorUserId` is required (`doc/decision/0016-*`): even an automatic
  waitlist promotion is triggered by a user canceling their own reservation.

## Risk if this is wrong

A typo in `payload` can't be fixed – only a new record can be appended. That's
deliberate, but it means the payload's shape needs to be thought through
**before** a service starts writing it.

The second risk is table growth: `AuditLog` never shrinks. At tens of
reservations a day that's on the order of thousands of rows a year, which is
nothing; if it ever becomes a problem, the fix is archiving into another table
(`INSERT … SELECT` + `DELETE` with the trigger temporarily disabled), not a
model change.

A third risk: the trigger also blocks `pg_restore`, if a restore ever used
`UPDATE`. It doesn't – `pg_restore` uses `COPY`/`INSERT` (verified in
`doc/database.md`, the Backups section, so far only from documentation, not
from an actual run).
