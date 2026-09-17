# 0032 – Prisma `P2002` is mapped to a contract code by `meta.target`

**Date:** 2026-08-28 · **Status:** accepted · **Follows on from:** `doc/decision/0018-*`,
`doc/decision/0016-*`, `doc/decision/0026-*`

## What

The global exception filter (`apps/garage/api/src/common/filters/contract-exception.filter.ts`)
translates `Prisma.PrismaClientKnownRequestError` into members of the closed `ERROR_CODES`
enum. `P2002` (unique-constraint violation) **doesn't map to a single code** — instead, the
decision is made by which index failed, which is carried in `error.meta.target`:

| unique index | contract code | HTTP |
| --- | --- | --- |
| `Reservation (parkingSpotId, date)` | `SPOT_ALREADY_RESERVED` | 409 |
| `Reservation (userId, date)` | `RESERVATION_LIMIT_REACHED` | 409 |
| `WaitlistEntry (parkingSpotId, userId, date)` | `ALREADY_IN_WAITLIST` | 409 |
| anything else | `CONFLICT` | 409 |

Beyond that, `P2025` (record not found) → `NOT_FOUND` and `P2003` (foreign-key violation) →
`CONFLICT`. An unrecognized Prisma code **isn't mapped at all** — it falls through into the
"unexpected error" branch and returns a bare 500 (see `doc/decision/0033-*`).

`error.meta` is **never** copied into the response. It carries column names, and sometimes
the constraint's name, and that's a schema detail, not information for the client.

## Why

`Reservation (parkingSpotId, date)` is a unique constraint precisely because **it** is what
makes a double booking impossible. The application-level check ("is this spot free?") and
the subsequent `INSERT` aren't atomic; under concurrent requests for the same spot, both
pass the check and one `INSERT` fails on the constraint. That's not an edge case – it's *the*
case the constraint exists for.

If `P2002` mapped uniformly to `CONFLICT`, the losing request in that race would tell the
user "conflict" instead of "this spot is already taken". If it wasn't mapped at all, it
would say "internal server error", and the UI would have no chance to offer the waitlist.
Branching on `meta.target` is the only way to get three different error domains out of one
Prisma code, because Prisma has no finer-grained code of its own.

**Why two shapes of `meta.target` have to be handled.** Prisma reports it either as an array
of column names (`['parkingSpotId', 'date']`) or as an index name
(`'Reservation_parkingSpotId_date_key'`). Which one arrives depends on the driver and
version, so `mapUniqueConstraintViolation` has to handle both – otherwise the mapping would
silently degrade to `CONFLICT` in production. Tests cover both forms.

**The exact set of columns is compared, not a substring.** The first version joined the
columns into a string and asked `includes`. That had two silent flaws: a column whose name
*contains* another (`dateFrom`, `updatedDate` against `date`) passed the test, and a superset
of a known constraint (`(parkingSpotId, date, tenantId)`) looked like that constraint.
Correctness then rested on the *order* of the conditions, not the conditions themselves. Now
a sorted set is compared for equality, and each branch additionally names its own table, so
order doesn't matter and a different table with the same pair of columns
(`Invoice_userId_date_key`) doesn't get mapped. All three traps have a test.

## How

```ts
// apps/garage/api/src/common/filters/contract-exception.filter.ts
export function mapUniqueConstraintViolation(meta: Record<string, unknown> | undefined): ErrorCode {
  const target = uniqueConstraintTarget(meta);
  if (targetMatches(target, 'WaitlistEntry', ['parkingSpotId', 'userId', 'date'])) return 'ALREADY_IN_WAITLIST';
  if (targetMatches(target, 'Reservation', ['parkingSpotId', 'date'])) return 'SPOT_ALREADY_RESERVED';
  if (targetMatches(target, 'Reservation', ['userId', 'date'])) return 'RESERVATION_LIMIT_REACHED';
  return 'CONFLICT';
}
```

Tests in `contract-exception.filter.spec.ts` construct **real**
`Prisma.PrismaClientKnownRequestError` objects (constructor `(message, { code, clientVersion,
meta })`), so no database is needed to run them. Both shapes of `meta.target` are covered, as
is the fact that `meta` never appears in the response.

## Risk if this is wrong

If a unique index's composition changes in a migration and this map isn't updated with it,
it fails **silently**: `P2002` falls through to `CONFLICT` and the user gets a generic
message instead of the right one. Nothing breaks, it just gets worse – exactly the class of
regression nobody reports. Touching unique indexes in
`libs/garage/database/prisma/schema.prisma` therefore has to go through this function too; the
tests only catch that the mapping does what it says, not that it matches the schema.

The exact-match comparison **amplifies** this tendency toward silent failure – previously a
changed constraint might still have passed the substring check, now it falls through to
`CONFLICT` for certain. That's a deliberate choice: degrading to a more general but truthful
error is better than confidently labeling a foreign constraint with a domain name it doesn't
belong to.
