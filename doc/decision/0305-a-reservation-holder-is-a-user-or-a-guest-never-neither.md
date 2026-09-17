# 0305 – A reservation holder is a user or a guest, never neither

**Date:** 2026-09-08 · **Status:** accepted · **Task:** `TODO.md` item 3, Task 1

## What

`Reservation.userId` is now nullable, and the row gained two columns:
`guestName` and `licensePlate`. A `CHECK` constraint,
`Reservation_holder_check`, keeps the table from ever holding a row that names
neither a user nor a guest — or both at once:

```sql
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_holder_check"
  CHECK (("userId" IS NULL) <> ("guestName" IS NULL));
```

The contract's `reservationSchema` mirrors this at the application boundary:
`userId` and `guestName` are both `.nullable()`, and `licensePlate` is a third
nullable column that overrides the holder's stored `User.licensePlate` for that
one day — the only plate a guest reservation can have, since a guest has no
`User` row to read one off.

## Why `<>` means "exactly one"

`<>` is boolean XOR here: each side of the operator is itself a boolean
(`"userId" IS NULL`, `"guestName" IS NULL`), and `<>` on two booleans is true
exactly when they differ.

- Both columns set (a row with no guest): `FALSE <> FALSE` → `FALSE` — rejected,
  because a guest reservation must not also carry a stale `userId`.
- Both columns null (no holder at all): `TRUE <> TRUE` → `FALSE` — rejected,
  which is the failure mode this record exists to close off.
- Exactly one set: `FALSE <> TRUE` or `TRUE <> FALSE` → `TRUE` — accepted.

Every other combination is impossible by construction: the two columns are
each either null or not, so there are exactly four cases, and the two that
survive are precisely the two the feature needs — a user holder and a guest
holder.

## Why `userId` is nullable rather than modelling a guest as a deactivated user

The alternative considered was giving every guest a real, synthetic `User` row
(deactivated, no Okta identity) so `Reservation.userId` could stay `NOT NULL`.
Rejected, for three reasons:

- **A guest is not a user who stopped being one.** `User.active = false` means
  "was an employee, no longer is" — offboarding, not a person who never had an
  account. Every existing reader of `active` (the admin user list, the
  reservation-window checks, `plan.md`'s own domain model) would have had to
  learn a second meaning for the same flag, or a new flag would have had to be
  invented to tell the two apart — at which point the synthetic row has bought
  nothing over just admitting `userId: null`.
- **A synthetic row invents identity that does not exist.** A guest has no
  email, no Okta subject, no login. `User.email` and `User.oktaId` are both
  `NOT NULL` and unique; a guest row would need fabricated values for both,
  and every future feature that joins on `User` (the Slack notification, the
  ICS feed, the admin user search) would have to be taught to recognise and
  skip fabricated users, forever.
- **The nullable column names the actual invariant.** "A reservation belongs to
  a user, or it doesn't" is the fact the domain has; a `CHECK` constraint says
  exactly that, in the one place — the table — that every writer and every
  future migration has to go through. A synthetic-user scheme would have
  pushed the same invariant ("never two synthetic guest users for one
  reservation", "never a synthetic user that also has real reservations") into
  application code, unenforced by the database.

## `(userId, date)` therefore places no limit on guests per day — intentionally

`@@unique([userId, date])` is what makes "one reservation per user per day"
true. In PostgreSQL, `NULL` is never equal to `NULL` for uniqueness purposes,
so a unique index on `(userId, date)` does not reject a second, third, or
tenth row with `userId = NULL` on the same day — only rows that agree on a
**non-null** `userId` collide.

That is not a gap being carried unnoticed: several guests visiting on the same
day is the expected shape of the feature (an admin can book one spot for one
guest, and a different spot for a different guest, both today), and nothing in
`plan.md` or this task caps how many guest reservations exist on a given day.
The double-booking guarantee that matters — one reservation per **spot** per
day — is unaffected: `@@unique([parkingSpotId, date])` does not mention
`userId` at all, and two guests can never be assigned the same spot on the
same day regardless of how their `userId` columns compare.

The real consequence is broader than "several guests may visit on the same
day": a guest has no identity beyond the free-text `guestName` an admin types,
so nothing stops one guest name from being given **every** bay in the lot on
one day — `(userId, date)` has nothing to say about it because every one of
those rows has `userId = NULL`. This is not enforced against, on purpose (see
above); it is worth stating so that it is not rediscovered later as a bug.

## What was measured

`apps/garage/api/src/database/database-contract.db.spec.ts` asserts all three cells of
the constraint against a real PostgreSQL 17: a row with neither `userId` nor
`guestName` is rejected, a row with both is rejected, and two guest rows on
different spots on the same day are accepted in the same transaction. `npx nx
run api:test-db` — 8 suites / 97 tests (up from the previously documented 94:
the three new cases above). `npx nx run contract:test`, `npx nx run
database:test`, `npx nx run api:test` and `npm run typecheck` all pass.
