# 0016 – Closed enums in the contract: AuditLog actions and UUID identifiers

**Date:** 2026-08-28 · **Status:** accepted

## What

Two things `plan.md` leaves open, the contract closes:

1. **`AuditLog.action` is a closed enum** (`auditLogActionSchema`), not a free
   `string`. The starting list is exactly the six actions `plan.md`
   §Doménový model names: `RESERVATION_CREATED`, `RESERVATION_CANCELLED`,
   `RESERVATION_CANCELLED_BY_ADMIN`, `WAITLIST_PROMOTED`, `USER_UPDATED`,
   `SPOT_UPDATED`.
2. **Entity identifiers are UUIDs** (`idSchema = z.uuid()`), including
   `User.preferredParkingSpotId`. **The UUID version is deliberately
   unconstrained** — `z.uuid()` accepts v1, v4, v7, and the nil UUID, and the
   contract leaves it that way.

## Why

**The action enum.** `plan.md` lists the actions with "e.g.", so the list isn't
exhaustive. A free `string`, however, would mean a typo (`RESERVATION_CANCELED`)
could land in an append-only table and never be fixable — and that filtering in
the admin UI would have nothing to offer. A closed enum is exactly what
contract-first means: whichever task introduces a new action must add it to
the contract first. Inventing them ahead of time
(`ICS_TOKEN_REGENERATED`, `BULK_RESERVATION_CREATED`, …) would be speculation:
if the name missed the mark, it would just create churn. **Tasks 12, 13 and 30
will extend the enum once they know exactly what they're recording.**

**UUID.** `plan.md` doesn't specify an id format. Contract-first means the
contract decides and the data model follows — not the other way around. UUID
is chosen because ids travel in URLs (`/reservations/:id`) and in realtime
event payloads and must not leak the record count or ordering. **Task 9
(Prisma schema) must use UUID, not cuid or an autoincrement.**

**Why no specific version.** The original wording of this decision, and a
comment in `primitives.ts`, both said "UUID v4", but `z.uuid()` doesn't enforce
that — it accepts v1, v7, and the nil UUID too (verified in the Task 3
review). The mismatch is resolved by **rewording, not by tightening to
`z.uuidv4()`**:

- The client never reads the id — it's an opaque string. The contract
  therefore has no interest in the version.
- `z.uuidv4()` would instead close the door for Task 9 on **UUIDv7**, which
  both Postgres and Prisma support and which gives better write locality on
  the primary key (a monotonic prefix) than a random v4. That choice belongs
  to the data layer, based on performance, not to the contract.
- The nil UUID (`00000000-…`) passes validation, but nothing in the system
  generates it; as a foreign key it doesn't exist and ends in `NOT_FOUND`. It
  is not an authorization hole.

Task 4 therefore only brought the prose in line with the schema's actual
behavior, in both places.

## How

- The enum lives in `libs/garage/contract/src/schemas/entities.ts` as
  `AUDIT_LOG_ACTIONS` (a tuple) and `auditLogActionSchema` (`z.enum`). A test
  on the exact composition of the list is deliberate — it forces whoever
  extends the enum to see the change.
- `idSchema` is a single place in `libs/garage/contract/src/schemas/primitives.ts`;
  entities just use it.
- `AuditLog.actorUserId` is required (not nullable) per `plan.md`: even an
  automatic waitlist promotion is triggered by a user canceling their
  reservation, so an actor always exists.

## Risk if this is wrong

Extending the enum is a one-line change in the contract plus a test update —
and TypeScript points at every call site. Changing the id format after Task 9
is no longer cheap (it means a data migration), which is why the decision is
recorded here rather than only in `doc/database.md`. If `actorUserId` ever
turned out to be missing for some future purely-system action (a cron job),
the fix is either a service-account user in the seed data, or narrowing the
field to nullable — either way, that's Task 13's call.
