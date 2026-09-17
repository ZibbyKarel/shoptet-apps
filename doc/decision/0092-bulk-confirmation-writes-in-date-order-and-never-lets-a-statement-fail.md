# 0092 – Bulk confirmation writes in date order and never lets a statement fail

**Date:** 2026-09-02 · **Status:** accepted · **Affects:** `apps/garage/api/src/reservations/bulk-*`
**Follows on from:** `doc/decision/0065-*`, `doc/decision/0066-*`

## What

`BulkReservationService.confirm` runs the whole batch in **one** interactive transaction, and that
transaction is built on three rules:

1. **Days are written in ascending date order.** The order comes from `allocateBulk`, which sorts
   its own input and whose output order *is* the row order of the `INSERT`; the service never
   writes in request order. Putting the answer back into the order the client asked for happens
   *after* the transaction, in memory. That sort is the **single authority** for the write order —
   see §"One authority" below, which is the correction of an earlier version of this record.
2. **No statement inside the transaction is allowed to fail.** Both writes are
   `createManyAndReturn({ …, skipDuplicates: true })` — `INSERT … ON CONFLICT DO NOTHING
   RETURNING …`. A day whose spot was taken between the read and the write simply does not come
   back in the returned rows, and the service reads the difference to decide what happened to it.
3. **There is no retry.** A batch that loses a genuine write conflict (`P2034`) fails whole, and
   the caller is told `CONFLICT`.

The transaction takes no `SELECT … FOR UPDATE` and no `FOR SHARE`, and deletes nothing.

## Why

### Ascending date order is the lock ordering

A confirmation holds up to 31 uncommitted `(parkingSpotId, date)` unique keys at once. An
uncommitted key blocks anybody inserting the same key until the holder commits or rolls back — that
is the mechanism `doc/decision/0065-*` found the hard way. Two transactions that take the same two
keys in opposite orders form a cycle, and PostgreSQL resolves a cycle by killing one of them.

Two `confirmBulk`s therefore cannot deadlock *against each other*: both acquire keys in ascending
date order, at most one reservation key per date, so their acquisition sequences are prefixes of the
same total order and no cycle exists. Request order would break it — two users selecting the same
week from opposite ends is not an exotic case, it is two people using a month grid.

The cycle is not hypothetical. `bulk-concurrency.db.spec.ts` builds the other side by hand — a
competitor that takes the later day first, waits, then reaches back for the earlier one — and
PostgreSQL reports `40P01 deadlock detected` every run.

### One authority

**This section replaces a claim in the first version of this record that was measured and found
false.** That version said the ordering came from `allocateBulk`, and that deleting it could not be
falsified end to end because "PostgreSQL takes the keys of one statement in one go, so the
interleaving cannot be forced from outside the process". Both halves were wrong, in different ways.

*There were two sorts, not one.* `BulkReservationService.assertRequestable` also returned
`[...dates].sort(compareDateOnly)`, and that sorted list was what reached the allocator. Measured on
the code as first written: **removing either sort alone → 3/3 confirmations fulfilled; removing both
→ 3/3 `P2034`.** Either sufficed, so neither could be killed by a test, and every document pointed
at only one of them.

*A multi-row `INSERT` is not atomic with respect to lock acquisition.* It acquires its unique keys
row by row and can be caught between them — this project's own deadlock log shows exactly that,
`CONTEXT: while inserting index tuple`. What a multi-row `INSERT` lacks is a yield point *available
to JavaScript*, which is a much weaker property than the one that was recorded, and one the database
can supply on its own.

Both are now fixed rather than merely restated:

- **The write order has exactly one authority**, `allocateBulk`'s `[...request.dates]
  .sort(compareDateOnly)`. It is the right home for it because the plan's order *is* the row order
  of the reservation `INSERT` (`createReservations` maps straight off `plans`), so nothing between
  the guarantee and the write can reorder it. `assertRequestable` still sorts, but only locally, to
  name the earliest offending day in a rejection; the dates it hands downstream are in request
  order. Two sorts would have been defensible as defence in depth, but only at the price of the
  guarantee being unfalsifiable — and an unfalsifiable guarantee is the one that rots.
- **Both remaining sorts are pinned by a test that fails when they are removed.** `allocateBulk`'s
  by `bulk-allocator.spec.ts` ("comes back in ascending date order, whatever order it was asked
  in") *and*, end to end, by `bulk-concurrency.db.spec.ts` › "a forced interleaving inside one
  multi-row INSERT": a test-only `BEFORE INSERT … FOR EACH ROW` trigger stalls each row of the
  `INSERT`, so each caller holds one day's key while reaching for the other's. With the sort, 3/3
  fulfilled; without it, 3/3 `rejected CONFLICT`. The trigger lives in the spec's own setup and is
  dropped in a `finally` — no production code, no runtime flag, no `NODE_ENV` branch.
  `assertRequestable`'s local sort is pinned by `bulk-reservation.db.spec.ts`, "names the earliest
  offending day, not the first one listed".

The conclusion the first version reached — keep the sort, and do **not** split the batch into
per-day statements merely to make a test possible — was right and still stands. Only its reasoning
was wrong. If the batch is ever split into per-day statements (a retry loop, a savepoint, a per-day
hook), the ordering becomes the only thing standing between two users and a deadlock.

### `confirmBulk` against `cancel` + promote

The first version of this record and the task report both said this pair cannot deadlock **because
"the `doc/decision/0065-*` cycle is built from `FOR UPDATE` plus a delete, and bulk takes neither"**.
That is the wrong shape of argument and it is retracted: a cycle needs two shared resources taken in
opposite orders, not two particular kinds of lock. Reasoning from lock *types* is how a "cannot"
survives long enough to ship.

The conclusion still holds, for a reason that is about the resources:

- `ReservationsService.cancel` + `WaitlistPromotionService.promote` is confined to **one date**. It
  takes `FOR UPDATE` on that cell's reservation and on that cell's queue, inserts one `Reservation`
  on that date, and `deleteMany`s the promoted user's `WaitlistEntry` rows *for that date*. Nothing
  it touches lies on a second day.
- `confirmBulk` contends for at most **one** resource per date in each of its two write phases, and
  the phases are sequential over the whole batch: every reservation first, then every queue entry.
  On any single date it therefore either holds a reservation key or later wants a queue key — never
  both, because a day that was assigned is not queued and a day that lost its cell holds nothing.

No cycle forms, but not because a return edge is missing outright — both edges exist, they just
never attach to the same date at the same time. The forward edge is real: `confirmBulk`'s queue `INSERT` blocking on a
`WaitlistEntry` key that `promote` has deleted but not yet committed. A return edge is real too, and
it is concrete, not abstract: `Reservation`'s `@@unique([userId, date])`. `promote` inserting
`(otherSpot, bulkUser, date)` collides with `confirmBulk`'s own uncommitted `(spot, bulkUser, date)`
on that index and does block `promote` — measured directly, a probe using this record's own trigger
technique caught `promote`'s `INSERT INTO "Reservation"` blocked by bulk on that index in four runs
out of four, and none of the four deadlocked.

What keeps the two from forming a cycle is not the absence of a return edge; it is that the two edges
need **mutually exclusive states on the same date**. The forward edge needs `confirmBulk` to be
*queueing* that date; the return edge needs `confirmBulk` to have *assigned* that date instead —
never both, because a day that was assigned is not queued and a day that lost its cell holds nothing.
`queueTargets` guarantees exactly that, and `cancel` + `promote` never leaves the date either, so the
wait cannot close the loop through a different day.

Note also that a *third*, hypothetical return edge — `promote`'s `deleteMany` waiting on the queue
entry `confirmBulk` is inserting uncommitted — does not exist: under `READ COMMITTED` a `DELETE` locks
only rows visible in its snapshot, so `promote`'s `deleteMany` never sees a row `confirmBulk` has
inserted uncommitted, and so never waits on it. This is the edge the original hypothesis pointed at;
it was the wrong one, and the `@@unique([userId, date])` edge above is the one that is actually real.

**Two changes would make this a real cycle, and both are plausible:** a `promote` that ever spans
more than one date, or a `confirmBulk` that interleaves its two write phases per day (a per-day
loop) instead of running them as two batches. If either happens, re-derive this. And if a cycle does
form, the blast radius is already bounded: `P2034 → CONFLICT`, a 409 on an all-or-nothing batch,
never a 500 and never a half-written booking.

### Why `ON CONFLICT DO NOTHING` instead of a retry

A bulk confirmation must survive *partial* failure: if one of twenty days lost its spot in the
milliseconds since the read, the other nineteen must still be booked. PostgreSQL does not offer
that inside a transaction — a failed statement aborts the whole thing — and Prisma exposes no
savepoints, so `try { insert } catch { … }` around a single day is not available at any price.

`skipDuplicates` moves the decision from the error channel to the result set. The insert cannot
fail, the returned rows say which days were actually taken, and the days that are missing fall
through to the queue exactly as if the read had seen them taken in the first place. The unique
indexes stay the enforcement — nothing here trusts the read.

The alternative was Task 13's shape: catch `P2002`, retry the transaction. For a 31-day batch that
means re-reading and re-writing everything to salvage one day, repeatedly, under exactly the load
that caused the collision. `MAX_CANCEL_ATTEMPTS = 3` is affordable for a single-row cancellation;
it is not the right instrument for a batch.

### Why no `SELECT … FOR UPDATE`, and the race this deliberately leaves open

Locking every candidate spot for every day would close the gap between the read and the write —
and would hold, for the length of a 31-day transaction, a row lock on every spot in the lot,
serialising every other reservation in the building behind one bulk booking. Worse, it would give
`confirmBulk` a second contended resource per date and a *return edge* against the cancel path
(previous section), turning a one-directional wait into a cycle.

So the gap stays open, and it is benign because it is self-correcting: the state can only change
*against* the plan (a free spot becomes taken; a taken one becoming free again cannot help, because
promotion is what frees it and promotion has its own queue). A day that loses its spot lands on the
waitlist for that spot — which is what would have happened had the read seen the truth. The caller
is never told something the database does not agree with: the answer is built from returned rows,
never from the plan.

### Why no retry on `P2034`

`doc/decision/0065-*` retries a cancellation because there is a specific, understood cycle it can
lose and re-running is cheap. Here, a `P2034` means an outside writer took the same cells in an
incompatible order; re-running the whole batch would re-read the world and produce a *different*
plan, which is not a retry so much as a second request the user did not make. `CONFLICT` says
exactly what happened and the client can ask again with the current state on screen. If bulk
confirmations are ever seen losing this race in practice, the upgrade path is a single
`pg_advisory_xact_lock` on the month — the same one `doc/waitlist.md` records for cancellation —
not a bigger attempt count.

## How

- `bulk-allocator.ts` — pure, sorts spots (group then label) and days (ascending), returns a plan.
  Both sorts are re-derived here rather than trusted from the caller, so a `findMany` that lost its
  `orderBy` cannot silently change what a bulk booking books, and the day sort is the single
  authority for the write order (§"One authority").
- `bulk-reservation.service.ts` — `confirmOnce` reads the world, allocates, inserts reservations,
  re-reads which of the still-unsatisfied days the caller has since acquired a reservation on,
  inserts queue entries for the rest, re-reads the queues for their positions, writes the audit
  rows, and returns the events. That second read covers days the allocator planned to **queue** as
  well as days it wanted to assign and lost: both would otherwise write an entry for a user who
  already holds that day. This *narrows* the race to the gap between that read and the queue insert
  that follows it — it does not close the gap. A promotion that commits in that narrower window
  still produces one reservation and one queue entry for the same day; see `doc/bulk-reservation.md`
  §"The race that is deliberately left open" for the measured shape (4/4) and why closing it fully is
  a design decision, not something this record claims is already done. `preview` runs the same
  allocation with no transaction and writes nothing.
- Events are returned from the transaction callback and published by the caller after it commits —
  the Task 13 seam (`DomainEventPublisher`), unchanged.
- Tests: `bulk-allocator.spec.ts` (preference order, both sorts, tiebreaks),
  `bulk-reservation.db.spec.ts` (writes, audit, broadcasts, the earliest-offending-day rejection,
  forced mid-transaction races on both an assigned and a queued day),
  `bulk-concurrency.db.spec.ts` (two callers in opposite order; the same pair with a test-only
  `BEFORE INSERT` trigger breaking the statement open; the hand-built deadlock).

## Risk

**A bulk transaction is long by this codebase's standards** — one read pass, two multi-row inserts,
a queue re-read and an audit insert, bounded by `{ maxWait: 5_000, timeout: 15_000 }`. It holds its
keys for that whole window. At single-instance scale with a lot of tens of spots this is
comfortable; it is the number to look at first if reservation latency ever becomes a complaint.

**The plan can be stale by the time it is written**, by design (above). The visible consequence is
that a preview can promise a spot and the confirmation can hand back a queue place instead. The UI
is built for that — the two responses share a shape so they can be laid side by side — but it is a
real thing users will occasionally see.

**Nothing here is multi-instance.** Ordering and unique indexes are properties of the database, so
they survive a second API process; the 15-second transaction budget and the absence of a retry are
tuned for one. Revisit both together, not separately.
