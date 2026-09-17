# 0234 – A promotion announces every queue it empties, not only the freed cell

## What

`WaitlistPromotionService.promote` now returns `clearedParkingSpotIds` — every
spot whose queue for that day lost a row — and `ReservationsService.cancelOnce`
emits one `waitlist:updated` per cell, with the recounted length, instead of one
for the freed cell alone.

The delete changed from `deleteMany` to `DELETE … RETURNING "parkingSpotId"`,
because `deleteMany` reports a count and the caller needs the names.

## Why

A promotion deletes **every** queue entry the promoted person holds for that day
(`waitlist-promotion.service.ts`), across all spots — correctly, since they now
hold a reservation and could never be promoted a second time. But the broadcast
named one cell: the one that was freed.

Worked case, already set up by `reservations.db.spec.ts`: a user queued for spot
A and spot B on the same day; A's holder cancels; the user is promoted onto A
and their entry on **B is deleted**. B's queue went 1 → 0 and no event said so.

`apps/garage/web/src/lot/lot-screen/day-overview-cache.ts` patches `waitlistCount` only for the
cell an event names, so every open day view kept showing B's badge as "1
waiting", and anyone queued behind the promoted user on B kept a
`viewerWaitlistPosition` one too high — until an unrelated event or a navigation
forced a refetch. The promoted user themselves was fine, because
`reservationReassignedTouchesViewer` invalidates for them, which is very likely
why nobody noticed.

The consumer side needs no change; it was correct given the events it received,
and simply never received one for the other cells.

## How it is kept true

The exhaustive-event assertion in `reservations.db.spec.ts` — which previously
pinned the omission as correct by asserting the event list was *exactly*
`['reservation:reassigned', 'waitlist:updated']` — now expects three events and
compares both `waitlist:updated` payloads by value, spot by spot. A test that
pins a bug is worse than no test, and that is what this one was.

## Risk

One extra `SELECT count(*)` per emptied cell, inside a transaction that is
holding row locks. Bounded by how many queues one person can be in on one day —
at most the number of spots — and in practice one or two. The recounts are
sequential rather than fanned out for that reason: an interactive Prisma
transaction is not a place to run queries in parallel.

**This record named the wrong risk, and the right one went unnamed.** The
recounts are harmless: a `SELECT count(*)` takes no row locks and cannot be a
party to a deadlock. What actually broke was the *other* change above — swapping
`deleteMany` for `DELETE … RETURNING` moved that statement onto `$queryRaw`, and
a deadlock on a raw statement comes back as `P2010`, which the cancellation
retry did not recognise. Half the concurrent cancellations in
`waitlist-concurrency.db.spec.ts` started failing. Fixed and measured in
`doc/decision/0240-*`; `doc/decision/0241-*` records why the recounts stayed
where they are.
