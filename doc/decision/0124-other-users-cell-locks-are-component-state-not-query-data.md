# 0124 – Other users' cell locks are component state, not query data

## What

`cell:locked` / `cell:unlocked` are the one pair of realtime events on the
parking screen that do **not** patch the query cache. They feed a
`Map<parkingSpotId, CellLockView>` held in `useCellLocks`
(`apps/garage/web/src/lot/lot-screen/use-cell-locks.ts`), which the screen passes into
`toSpotView` as part of its context.

The map is emptied when the day changes and when the connection drops, and
individual entries are dropped when their `expiresAt` passes.

## Why

### There is no query to patch

`plan.md` says "no ad-hoc local state", and `doc/decision/0123-*` implements
that for the four events that have somewhere to go. A cell lock has nowhere:
`overview.day` returns spots, reservations, waitlist counts and the window, and
**nothing about holds**. There is no procedure in the contract that reports the
current locks, and there should not be — a hold lives about thirty seconds and
exists only as a broadcast.

Putting it in the cache would mean minting a query key no procedure backs. That
is precisely the contract-first rule inverted: a cache entry that no endpoint
can produce, refetch, or invalidate, whose only writer is an event handler.
Calling that "query data" would be a costume, not a mechanism.

So this is component state **because the contract says so**, not for
convenience, and it is the only such state on the screen.

### Expiry is the contract's instruction, not a UI workaround

`cellLockedEventSchema` requires the client to do this:

> `expiresAt` travels with the event so a client can clear the state on its own
> when the TTL runs out. A lost `cell:unlocked` (a browser closed mid-edit, a
> dropped socket) must not freeze a tile forever.

Task 21's report parks a related hazard — "`held-by-other` can stick if the
server never broadcasts expiry" — as a Task 15 question. The sweep here is
**not** a paper-over of that: it acts on a field the event is specified to
carry, for a case (`cell:unlocked` never sent) the contract names. It is
scheduled to the soonest `expiresAt` rather than run on an interval, so an
empty map costs no timer.

An unparseable `expiresAt` **keeps** the lock rather than dropping it —
`Date.parse` gives `NaN` and every comparison with `NaN` is false. Keeping is
the safe direction: the tile reads as busy, and the holder's own renewal
heartbeat corrects it within half a TTL.

### Clearing on disconnect

While the socket is down no `cell:unlocked` can arrive. Continuing to hatch a
tile would assert something this client has no way to know is still true, so
the map empties. After a reconnect it starts blank and refills from the renewal
heartbeats holders are already sending (`cell:lock` at half the TTL,
`doc/decision/0062-*`) — **provided the gateway re-broadcasts a renewal**, which
is Task 15's to settle. If it does not, a hold taken before the drop stays
invisible until it is next renewed or released. Being briefly blind is the safe
direction: the lock is a courtesy, not authorisation, and `reservation.create`
re-checks everything.

### A lock this client holds is ignored

`toSpotView` drops a lock whose `holderId` is the viewer. Whether the gateway
echoes a broadcast back to its sender is unspecified; either way the caller
with the dialog open must not see their own tile hatched and their own action
taken away. This makes the screen correct under both gateway behaviours rather
than depending on one.

## Consequences

- Two hooks with similar names and opposite jobs, which is worth stating
  plainly: `useCellLock` (`libs/garage/realtime-client`) takes and renews **this**
  client's hold on **one** cell; `useCellLocks` (this) tracks **everybody
  else's**, across the whole day.
- The lock map is deliberately not persisted, not refetched and not shared
  between days.
- The pure parts (`pruneExpiredLocks`, `nextLockExpiryAt`) are exported and
  tested on their own, including the `NaN` boundary.

## Verified by

`apps/garage/web/src/lot/lot-screen/use-cell-locks.spec.tsx` (20 tests). Measured (mutants
M12–M14 in the task report): mutating the sweep to never expire fails **5**
tests — three on `pruneExpiredLocks` and two on the hook; mutating the effect to
keep holds across a disconnect fails **1**; mutating the `cell:locked` handler
to accept any day fails **1**.
