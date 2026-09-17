# 0026 – The `ReservationWindowSettings` singleton is enforced by a `CHECK` constraint

**Date:** 2026-08-28 · **Status:** accepted · **Follows on from:** `doc/decision/0004-*`, `doc/decision/0016-*`

## What

The `ReservationWindowSettings` table may contain **exactly one row**. This is
enforced by a combination of the primary key and a `CHECK`:

```prisma
model ReservationWindowSettings {
  id             Int                 @id @default(1)
  openDaysBefore Int                 @default(7)
  lockMode       ReservationLockMode @default(AUTO)
  updatedAt      DateTime            @updatedAt @db.Timestamptz(3)
}
```

```sql
ALTER TABLE "ReservationWindowSettings"
  ADD CONSTRAINT "ReservationWindowSettings_singleton_check" CHECK ("id" = 1);

ALTER TABLE "ReservationWindowSettings"
  ADD CONSTRAINT "ReservationWindowSettings_openDaysBefore_range_check"
  CHECK ("openDaysBefore" BETWEEN 1 AND 31);
```

The row is created by the **init migration** (`INSERT … ON CONFLICT ("id") DO
NOTHING`), not by a seed.

## Why

**Why enforce it at all.** "The app only ever writes one row" is a habit, not
a guarantee. If a second row appeared in the table, reading the settings would
start returning a nondeterministic result and the reservation window would
behave randomly — exactly the class of bug nobody can reproduce.

**Why `CHECK (id = 1)` on top of a fixed primary key.** The primary key
forbids a **second** row with `id = 1`; the `CHECK` forbids **any other**
`id`. Together: the table can never hold more than one row, regardless of who
writes to it — the application, `psql`, Adminer, a future migration. Reading
is then trivial (`findUnique({ where: { id: 1 } })`) and needs neither
`findFirst` nor `LIMIT 1`.

Alternatives considered:

- **A partial unique index** (`CREATE UNIQUE INDEX … ON t ((true))`) works
  just as well, but it's a more obscure way of writing the same thing, and
  reading still needs to know how to address that one row.
- **`@@unique` over a constant column** means an extra column that means
  nothing.
- **Settings as rows in a key-value table** would give up type checking
  (`openDaysBefore` is an `int`, `lockMode` is an enum) and push validation
  into the application.

**Why `id` isn't a UUID.** `doc/decision/0016-*` says **entity** identifiers
are UUIDs, because they travel in URLs and realtime payloads and must not
leak ordering or count. This `id` goes nowhere: the
`reservationWindowSettingsSchema` in the contract has no `id` field at all —
the API reads and writes the settings with no identifier. It's an internal
storage detail, so 0016 doesn't apply to it — and only with a fixed small
number can the `CHECK` be this trivial.

**Why the row is created by a migration, not a seed.** The table must never
be empty (every reservation path reads it), and `prisma db seed` doesn't run
in production. The seed still upserts the values for good measure, so a
manually messed-up dev database returns to a known state.

**The `openDaysBefore` range.** The contract bounds it to 1–31
(`MIN_OPEN_DAYS_BEFORE`/`MAX_OPEN_DAYS_BEFORE`). The same `CHECK` in the
database is cheap and guards against writes that bypass the API.

## How

Both `CHECK` constraints and the `INSERT` are **hand-appended to the end** of
the generated `migration.sql` – Prisma's schema language can't express them.
The test `libs/garage/database/src/lib/migration-sql.spec.ts` asserts their presence
directly, so they can't be lost when the migration is regenerated.

**Trap:** `prisma migrate dev` compares the post-migration state against
`schema.prisma`, so it sees these objects as drift and proposes dropping them
in the next migration. The procedure for every subsequent schema change is
documented in `doc/database.md` (§"Trap: hand-written SQL and `migrate dev`"):
`--create-only`, then delete the `DROP CONSTRAINT`/`DROP TRIGGER` from the
generated SQL, and only then apply it.

## Risk if this is wrong

The main risk isn't the constraint itself, it's the trap above: if someone
misses it, a silent `DROP CONSTRAINT` in a new migration removes the
singleton guarantee, and nobody notices until a second row shows up. That's
why a test asserts it, and why it's written up in `doc/database.md` as a
procedure, not a footnote.

If more than one settings row is ever needed (e.g. per-location settings), the
whole model falls apart — but that's no longer "changing a constraint", it's
a new entity with a foreign key.
