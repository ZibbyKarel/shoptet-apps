# 0240 – A deadlock on a raw statement is `P2010`, not `P2034`, and the cancel retry must match both

## What

`ReservationsService.isRetryableConflict` no longer tests `error.code ===
'P2034'`. It calls a new `isWriteConflict` in
`apps/garage/api/src/common/filters/contract-exception.filter.ts`, which is true for
`P2034` **and** for a `P2010` whose underlying SQLSTATE is in class 40
(transaction rollback: `40001` serialization failure, `40P01` deadlock
detected). `mapPrismaErrorCode` maps the same `P2010`s to `CONFLICT`; every
other `P2010` still degrades to a 500, because a bad cast in raw SQL is a
defect and not somebody else's race.

Nothing about the *behaviour* `0234` bought changed. Every emptied queue still
gets its own `waitlist:updated`, and the recounts still happen inside the
transaction. See `0241` for why they stay there.

## Why

`0234` changed one line in `WaitlistPromotionService.promote`:

```
-  await tx.waitlistEntry.deleteMany({ where: { userId: candidate.userId, date: dateColumn } });
+  const cleared = await tx.$queryRaw<{ parkingSpotId: string }[]>`DELETE FROM "WaitlistEntry" … RETURNING "parkingSpotId"`;
```

That was the right change for the reason `0234` gives — `deleteMany` reports a
count, and the caller needs the names. What it also did, invisibly, was move
that statement off Prisma's query API and onto `$queryRaw`.

Prisma translates a deadlock **on its own generated SQL** into `P2034`. It does
not translate one on a raw statement at all: the driver's error is wrapped
verbatim as `P2010` ("Raw query failed"), and the `40P01` survives only inside
`meta`. Measured, from the failing test:

```
code: 'P2010'
message: 'Raw query failed. Code: `40P01`. Message: `deadlock detected`'
meta: { driverAdapterError: { cause: {
         originalCode: '40P01', originalMessage: 'deadlock detected',
         kind: 'TransactionWriteConflict' } } }
```

The retry predicate tested only `P2034`. So from `0234` onwards, exactly half of
the deadlocks in the cancellation path stopped being retried — and which half
was decided by the server, not by us. The cycle is the one already documented in
`isRetryableConflict`: two cancellations on different spots, same day, whose
queues are headed by the same person. PostgreSQL picks one of the two waiting
statements as the victim, and the two candidates are

- the promotion's `INSERT INTO "Reservation"` — Prisma's SQL, `P2034`, retried,
  the cancellation succeeds;
- the cross-cell `DELETE FROM "WaitlistEntry"` — ours, `P2010`, **not** retried,
  the cancellation fails with a 500.

Read from the PostgreSQL server log over eight runs of
`waitlist-concurrency.db.spec.ts` alone: eight deadlocks, five with `CONTEXT:
while deleting tuple … in relation "WaitlistEntry"` and three with `while
inserting index tuple … in relation "Reservation_userId_date_key"` — and exactly
those five runs failed. One-to-one, not a correlation.

In production this meant two people cancelling at the same time could deadlock
and one of them would get an error, on a request that had no business failing.
That is worse than the stale badge `0234` was written to cure.

## The measurement

Matched pairs on one machine and one database, `npx nx run api:test-db
--skip-nx-cache`, failing at `waitlist-concurrency.db.spec.ts:447`:

| tree | failures |
| --- | --- |
| before this record (`5a4fbb6`) | **6 of 12** |
| after | **0 of 24** |

The deadlocks did not go away — that would prove nothing but a change of timing.
Across the 24 green runs the server logged **20** deadlocks whose victim was the
raw `DELETE`, every one of them absorbed by the retry.

The scoped re-review that found this measured 0 of 12 on `4add0bd` against 5 of
12 on `5a4fbb6`, with the spec unchanged between them.

## How it is kept true

Two tests, at the two levels the mistake was possible at.

`database-contract.db.spec.ts` gains "a deadlock on a raw statement", a twin of
the existing `P2034` case: the same two-`ParkingSpot` cycle with only the
statements swapped for `$executeRaw`, asserting `P2010`, the `40P01` in `meta`,
and that both `isWriteConflict` and `mapPrismaErrorCode` agree it is a lost
race. This is the pin that did not exist — the `P2034` shape had been checked
against a real server since Task 13, and the raw shape never had, which is
precisely why swapping one call for another could change the code without
anything going red.

`cancel-retry.spec.ts` gains the retry-side claim and its negation: a `P2010`
carrying `40P01` is retried `MAX_CANCEL_ATTEMPTS` times and reports `CONFLICT`;
a `P2010` carrying `22P02` (a bad uuid cast) is not retried at all. Both shapes
are transcribed from a live server, per that file's standing rule that a double
may stand in for *when* an error arrives, never for what one looks like.

Both were checked by reverting the fix under them: the first fails, and the
`P2010` retry test fails, without it.

## Risk

`isWriteConflict` matches SQLSTATE class 40 by prefix rather than listing
`40001` and `40P01`. That is deliberate — the class *is* the property that
matters, since the server has already rolled the transaction back — but it means
a future class-40 code is retried without anyone deciding to. Class 40 has three
members in PostgreSQL 17 and the third (`40003`, statement completion unknown)
cannot reach a retry loop that only ever sees committed or rolled-back
transactions.

`rawQuerySqlState` reads `meta.code` before the driver-adapter path, mirroring
what `uniqueConstraintTarget` does for `P2002` and for the same reason: the
former is what Prisma documents and what a query-engine-backed client would
emit, the latter is what `@prisma/adapter-pg` actually produces today. The error
*message* also carries the code and is deliberately not parsed — a predicate
that decides whether to re-run a transaction on the strength of a substring in
prose is one upstream rewording away from silently not retrying, and silently
not retrying is invisible until it is a matched-pair measurement.
