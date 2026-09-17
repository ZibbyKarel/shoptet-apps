# 0123 – A broadcast patches the cache, and additionally invalidates what it is not allowed to carry

## What

Every server → client event on the parking screen is handled the same way, in
`apps/garage/web/src/lot/lot-screen/use-lot-realtime.ts`:

1. read the day overview out of the query cache, under the key
   `createApiQueryUtils` derives from the contract;
2. apply a **pure patch** for that event (`./day-overview-cache`), writing back
   only if the patch changed anything;
3. **additionally** `invalidateQueries` that key when the event could have
   moved a *viewer-relative* field.

| event | patched | also refetched when |
| --- | --- | --- |
| `reservation:created` | `spots[i].reservation` | the caller is the new holder |
| `reservation:cancelled` | `spots[i].reservation = null` | it was the caller's own reservation |
| `reservation:reassigned` | `spots[i].reservation` | the caller was promoted, lost the spot, or is queued for it |
| `waitlist:updated` | `spots[i].waitlistCount` | the caller is in that queue |

`cell:locked` / `cell:unlocked` are not in this table — see `0124`.

## Why

`plan.md` (Fáze 6) asks for "one consistent mechanism, no ad-hoc local state".
Two mechanisms suggest themselves and both are wrong on their own.

**Patch only.** Impossible for four fields. `dayOverviewOutputSchema` carries
`canReserve`, `viewerReservationId`, `viewerWaitlistEntryId` and
`viewerWaitlistPosition`, all of which are *this caller's* answer. (Task 31
added a fifth, `canReserveMonth` — same reason, it carries the admin exemption.
The argument below is unchanged by the count.) A broadcast
goes to a whole day room and may not say anything viewer-relative — the
contract states the constraint and the reason:

> Who is queued for a spot is not public … this event goes to every member of
> the day room, so it cannot say more than the day overview says to a stranger.
> A client whose own position may have moved refetches the day; there is no way
> to broadcast "your position is now 2" to a room without telling everyone else
> who is in the queue.

So a patch-only screen would show a permanently stale queue position, and a
`canReserve` that never flips after the caller books from another tab.

**Invalidate only.** Correct but wasteful and visibly slower. Every payload
that *can* carry the shared change already does — `reservationCreatedEventSchema`
sends the whole `publicReservation` explicitly so "the tile has to render the
new holder's name and plate immediately, and a client that had to re-fetch the
day to learn them would defeat the point of the broadcast". Nine people
watching one day would each fire a request on every reservation anyone makes.

Doing both is not two mechanisms; it is one rule with two halves — *patch what
the payload determines, refetch what it is forbidden to determine* — and the
line between them is drawn by the contract rather than by taste. The patch
repaints on the same tick; the refetch corrects the four viewer fields a moment
later, and only for the callers those fields moved for.

## Consequences

- The patches are pure functions of `(day, event)` in a separate module with no
  React in it, so the interesting logic is testable without a DOM.
- Every patch **returns the same object reference** when nothing changed —
  wrong day, unknown spot, redelivered event, unchanged count. A client is
  normally in several day rooms and Socket.io does not tell a handler which one
  a message arrived through, so the day guard is load-bearing rather than
  defensive.
- The query key is never written down. Both the hook and its test derive it
  from `createApiQueryUtils`, because a key that differs by one character
  produces a patch nothing renders — indistinguishable from a broadcast that
  never arrived, and the same failure shape as Task 23's 404 bug.
- Measured (mutants M15–M17 in the task report): removing the **invalidation**
  half fails 4 tests, removing the **patch** half fails 2, and hand-writing the
  query key instead of deriving it fails 6. Neither half is decoration, and the
  derived key is load-bearing for both.

## Verified by

`apps/garage/web/src/lot/lot-screen/day-overview-cache.spec.ts` (24 tests, the pure patches and
the four predicates) and `apps/garage/web/src/lot/lot-screen/use-lot-realtime.spec.tsx` (14
tests, the wiring and the key).
