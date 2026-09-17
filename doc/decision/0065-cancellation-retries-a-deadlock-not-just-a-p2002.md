# 0065 – A cancellation retries a deadlock, not just the promotion's `P2002`

**Date:** 2026-09-02 · **Status:** accepted · **Affects:** `apps/garage/api/src/reservations/`

## What

`ReservationsService.cancel` retries its transaction (up to `MAX_CANCEL_ATTEMPTS = 3`) on **two**
Prisma errors, not one:

- `P2002` whose constraint is `Reservation (userId, date)`, and
- **`P2034`** — PostgreSQL `40001` / `40P01`, a serialization failure or deadlock.

`mapPrismaErrorCode` in `contract-exception.filter.ts` additionally maps `P2034` to the contract
code `CONFLICT`, so a write conflict that outlives the retries reaches the client as a 409 rather
than a 500.

## Why

**The deadlock is real, and it was found by a test rather than by reasoning.**
`waitlist-concurrency.db.spec.ts` runs two ordinary cancellations of two different spots on the
same day, whose queues are headed by the same person. One of them came back:

```
code: 'P2034'
meta: { driverAdapterError: { cause: {
         originalCode: '40P01', originalMessage: 'deadlock detected',
         kind: 'TransactionWriteConflict' } } }
```

The cycle:

```
T1 (spot A)                             T2 (spot B)
FOR UPDATE on A's queue          ✓      FOR UPDATE on B's queue          ✓
INSERT reservation for W         ✓
                                        INSERT reservation for W  → waits on T1's
                                          uncommitted (userId, date) key
DELETE W's queue entries for the day
  → waits on B's queue row, held by T2
```

**No ordering of the locks this design takes removes it.** The usual remedy — acquire locks in a
canonical order — needs each transaction to know up front which rows it will touch. Here it cannot:
which *other* cells a promotion must reach into is decided by which candidate the queue turns out to
be headed by, and the cross-cell `DELETE` is required by the rule (`plan.md`: "their other waitlist
entries for the same day are deleted"). Dropping that delete would leave a promoted user visibly
queued for spots they can no longer be promoted to. An ordering that *would* remove the cycle does
exist — lock the whole day's queue rows in canonical order before writing, rather than only the
current cell's — but that is not a variant of the current per-cell locking; it is functionally the
`pg_advisory_xact_lock` upgrade path two paragraphs below, with the same cost (every promotion for
one day serialised against every other).

**Retrying is the documented remedy and it converges.** After the winner commits, its promoted user
has a committed reservation, so the retry's eligibility read skips them — and therefore never
reaches into the other cell at all. Each attempt eliminates at least one candidate; with N people
queued, at most N attempts are meaningful. `MAX_CANCEL_ATTEMPTS` bounds it regardless.

**Why `P2034` also gets a `CONFLICT` mapping.** Before this, an unretried write conflict anywhere in
the application was an unmapped Prisma error, which the filter answers with 500 and a logged stack.
That is wrong twice over: it tells an operator to hunt for a defect that does not exist, and it
tells the client not to retry when retrying is exactly the right advice. `CONFLICT`'s own definition
in `ERROR_DEFINITIONS` is *"the request lost a race against a concurrent change"*, and its Czech copy
already says "someone else made the same change — please try again".

**Why not `pg_advisory_xact_lock` on the day.** It would remove the cycle outright by serialising all
promotions for one day, and at this scale it would cost nothing. It also serialises cancellations
that have nothing to do with each other, and it replaces a mechanism PostgreSQL already provides
(deadlock detection) with one this codebase would have to maintain. Recorded as the upgrade path in
`doc/waitlist.md` if the retry rate ever becomes visible.

## How

- `ReservationsService.isRetryableConflict` — the predicate, with the cycle drawn in its comment.
  `SPOT_ALREADY_RESERVED` is deliberately excluded: it would mean somebody took the cell this
  transaction was in the middle of freeing, which cannot happen while our delete is uncommitted, so
  it would be a defect and retrying a defect only makes it slower.
- `PRISMA_WRITE_CONFLICT` is exported from `contract-exception.filter.ts` so the predicate and the
  mapping read the same constant.
- The real `P2034` shape is pinned against PostgreSQL in `database-contract.db.spec.ts`
  ("the shape of a deadlock"), next to the `P2002` shape, for the same reason: the retry predicate
  and the mapping both read `code`, and a double must never be the thing that decides what a
  database error looks like.

## Risk

**A retry re-runs the whole cancellation, including its audit write.** Harmless — the failed attempt
rolled back, so no `AuditLog` row survives it. `waitlist-concurrency.db.spec.ts` asserts exactly one
`WAITLIST_PROMOTED` entry after a forced retry, which is what makes that claim exercised rather than
argued.

**Three attempts is a guess.** It is enough for the two-cancellation race that actually occurs, and
the fourth would be paid for in held row locks. If `CONFLICT` from this path is ever seen in
practice, the advisory-lock upgrade above is the answer, not a larger number.
