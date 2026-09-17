# 0307 – The monthly cap takes an advisory lock, and `confirmBulk` retries

**Date:** 2026-09-09 · **Status:** accepted, partly superseded by
`doc/decision/0312-the-monthly-cap-is-its-own-settings-singleton.md` (the cap
became an admin-configurable setting; the lock, recount and deadlock analysis
below are unaffected) · **Task:** `TODO.md` item 4

## What

`apps/garage/api/src/reservations/monthly-reservation-cap.ts` enforces a cap on
confirmed reservations per user per calendar month — five, fixed, when this was
written; an admin-configurable setting since `doc/decision/0312-*`, read as a
parameter rather than a constant. Every path that inserts a
`Reservation` row for a real user calls `assertWithinMonthlyReservationCap` as
its last check before the insert, inside the transaction that will do the
insert: `ReservationsService.create`, `BulkReservationService.confirmOnce`, and
`WaitlistPromotionService.promote` (which skips an over-cap candidate rather
than failing the cancellation that triggered it).

The check takes `pg_advisory_xact_lock(hashtextextended('<userId>:<YYYY-MM>', 0))`
and then recounts. That lock is the subject of this record.

## Why a lock, and not a counter

The cap is computed, not stored: no column, no migration, and no unique index
that could reject an over-cap insert the way `Reservation(userId, date)` rejects
a second booking on one day. That difference is the whole design. The per-day
rule can afford an optimistic pre-check because the index is the final arbiter
and `P2002` is the answer when the pre-check loses a race. The monthly rule has
no arbiter, so a bare `count()` is a read of state another transaction is in the
middle of changing: two concurrent bookings both read four, both decide five is
fine, and the user ends the month with six.

A stored counter column was considered and rejected. It would have to be
maintained by every writer of a `Reservation` row — including cancellation,
which decrements, and waitlist promotion, which moves a row between users — and
a denormalised count that disagrees with the rows it counts is a class of bug
that outlives whoever introduced it. The lock plus a recount inside it costs one
extra statement on a path that is already doing several, and it cannot drift,
because there is nothing to drift from.

Advisory rather than a row lock because there is no row to lock: the resource
being serialised is "this user's budget for this month", which exists only as a
predicate over rows. `hashtextextended` rather than `hashtext` because
`pg_advisory_xact_lock` takes a `bigint`; `$executeRaw` rather than `$queryRaw`
because Prisma's raw-result deserializer rejects a `void` column.

## What it costs: a new deadlock between `confirmBulk` and `cancel` + promote

The first version of this design claimed the new lock was disjoint from the
`FOR UPDATE`/`FOR SHARE` row locks the reservation and waitlist services already
take, and therefore could not form a cycle with the deadlock
`doc/decision/0065-*` documents. That claim was wrong, and the comments that
carried it have been corrected.

`BulkReservationService.confirmOnce` takes the advisory lock, inserts its
reservations, and then has `releaseOwnQueues` `DELETE` the caller's
`WaitlistEntry` rows for the days it just assigned. That `DELETE` can block on a
queue row a concurrent `cancel` + `promote` is holding `FOR UPDATE` — while that
same transaction is blocked on our advisory lock, because promotion recounts the
promoted user's month before it inserts:

```
T1 = cancel + promote (spot S, day D)      T2 = confirmBulk by U, month M (D included)
FOR UPDATE on S's queue for D       ✓      advisory(U, M)                          ✓
  assertWithinMonthlyReservationCap(U, M)    createReservations
    → blocks on advisory(U, M)               releaseOwnQueues: DELETE U's entries
                                               → blocks on S's queue row, held by T1
```

A cycle, and PostgreSQL kills one side with `40P01`.

The deadlock table in `doc/bulk-reservation.md` used to rule this pair out on the
grounds that `cancel` + promote is confined to one date, and that on any one date
`confirmBulk` holds either a reservation key or a queue key but never both. That
argument was sound for the resources that existed when it was written. It does
not survive a resource with a different granularity: the advisory key is scoped
to a month, so the two edges no longer have to land on the same date to meet.
The document named two changes that would close the cycle; this is a third it
did not anticipate.

`WaitlistPromotionService.promote` can also take the lock more than once per
transaction — once per skipped over-cap candidate before it promotes somebody.
That is not itself a cycle (the same transaction re-acquiring a lock it already
holds does not block), but it does mean the "taken at most once, last" property
the original comment asserted is not true either.

## The mitigation is a retry, not an ordering

No lock ordering removes this. Ordering requires a total order over the
contended resources that both sides can compute before they take the first one,
and here the resources have two different granularities — a month-scoped
advisory key and date-scoped row locks — with no natural order between them, and
neither transaction knows which queue rows it will reach for until it has read
the queue.

So `confirmBulk` retries, the same shape `ReservationsService.cancel` already
uses for the cycle in `doc/decision/0065-*`.
`BulkReservationService.committedConfirm` wraps the transaction in a bounded
loop, retries on `isWriteConflict` — deliberately broad, because the same
`40P01` arrives as `P2034` from Prisma's own SQL and as `P2010` wrapping
`40P01` from a `$queryRaw`, and `doc/decision/0240-*` records what getting that
distinction wrong looked like — and throws `CONFLICT` when the attempts run out.
It reuses `MAX_CANCEL_ATTEMPTS` rather than declaring a second bound: both loops
guard the same condition against the same wait graph, and two numbers that must
agree but are written down twice eventually disagree.

The retry does **not** widen what `confirmBulk` tolerates. The class comment's
rule still holds — no statement in that transaction may raise — and in
particular a `P2002` is not retried: `createManyAndReturn({ skipDuplicates:
true })` turns a lost cell into a missing row, so a unique violation there would
be a defect in the file, and retrying a defect only makes it slower.

**Why it terminates.** Not for the reason `cancel`'s loop does. That one
eliminates a candidate per attempt, and re-running `allocateBulk` makes no such
monotone progress — it can reach for the same cells again. What is true is that
the transaction we deadlocked with has committed or rolled back by the time the
retry starts, so the retry does not replay the identical interleaving, and any
cell the competitor won comes back from the retry's `ON CONFLICT DO NOTHING`
insert as a missing row, leaving strictly fewer days to assign.
`MAX_CANCEL_ATTEMPTS` bounds it regardless, because a bound resting on an
argument about somebody else's code is not a bound.

`CONFLICT` is the right answer when the attempts run out, and it was already
declared on `confirmBulkContract`. The caller has no reservation problem of
their own — they lost a race with somebody they have never heard of — and the
batch is all-or-nothing, so a losing attempt wrote nothing and trying again is
genuinely the remedy the message suggests.

## What is not tested

Two gaps, and the second is the more expensive one.

**The cycle itself is not forced in a suite.** Reproducing it needs two real
concurrent transactions and a barrier between the advisory lock and the
`DELETE`, in the style of `waitlist-concurrency.db.spec.ts`. The retry path is
exercised — `bulk-concurrency.db.spec.ts` › "deadlocks, and the retry absorbs it
without a half-written batch" now runs through it against a real `40P01` — but
by way of a cell-ordering cycle, not the cap's.

**The retry is wider than the cycle it was added for, and it disarmed a
falsification.** A `40P01` from the cap cycle and a `40P01` from two writers
taking the same cells in opposite order are the same error, and nothing
observable inside the transaction separates them: the cap check runs _before_
`createReservations`, so "did this attempt take the advisory lock" is true for
both. Narrowing the retry is therefore not available, and the retry absorbs the
cell-ordering deadlock too.

That deadlock was the end-to-end guard on `allocateBulk`'s ascending-date sort —
the invariant the whole of `doc/bulk-reservation.md` §"Deadlock" rests on.
Deleting the sort used to produce `3/3 rejected CONFLICT`; now the retry
swallows the first deadlock, so a missing sort surfaces only if the retries lose
as well, which has not been measured. `bulk-allocator.spec.ts` still pins the
sort directly, but that is a unit assertion about a returned array, not a
demonstration that the order prevents a deadlock. The class comment on
`BulkReservationService`, which claimed the sort was "pinned twice", has been
corrected to say so.

This is a deliberate trade, not a discovery: the cap needs an authoritative
recheck, the recheck needs the lock, the lock needs the retry, and the retry
costs this. Rebuilding the falsification — most plausibly by counting attempts,
so that a deleted sort shows up as "the retry was consumed" rather than as
silence — is follow-up work and is recorded here so it is not rediscovered by
somebody deleting the sort and finding the suite green.
