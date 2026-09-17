# 0220 – Giving a hold back is keyed by the connection; taking one is not

## What

`LockService.release` now takes the same `LockRequester` — `{ user, socketId }`
— that `acquire` takes, and frees the cell only when **both** halves match the
recorded hold:

```ts
abstract release(cell: LockCell, requester: LockRequester): boolean;
```

`acquire` is unchanged: it is still keyed by user, so re-sending `cell:lock` on
a new connection is still a renewal rather than a `HELD_BY_OTHER`.
`releaseSocket` is unchanged: it was already socket-keyed.

## Why

**Because "may this connection take the cell?" and "is this connection the one
currently holding it?" are different questions, and `release` was answering the
second with the first.**

Ownership is by user (`lock.service.ts`, "Ownership is by user, not by socket").
That is right, and it is what makes a reconnect a renewal: `acquire`'s same-user
branch overwrites `socketId`, so the hold follows the user onto the new
connection. But `release(cell, userId)` inherited that key without inheriting
the reason for it, and the consequence is that **any** connection of the holder
could drop the hold, including one the holder has already superseded.

Two ways a user has two live connections on one cell:

- **two tabs** — the plain case, and the one `doc/decision/0187-*` recorded as a
  finding rather than fixing: closing the dialog in one tab frees the bay for
  everyone while the other tab's form is still open, until that tab's next
  renewal (up to half the TTL, ~15 s);
- **a reload** — the new document takes the hold immediately, while this server
  can take until `pingTimeout` (~20 s on an abrupt drop) to notice the old
  socket is gone. Anything that connection still emits lands against a hold that
  is no longer its own.

Measured before the change, `apps/garage/api/src/realtime/lock.service.spec.ts`:

```
● InMemoryLockService › giving a hold back › REPRO: a stale connection
  releases the hold its user re-took elsewhere
    Expected: false
    Received: true
```

and at the socket level in `realtime.gateway.spec.ts`, the `cell:unlocked`
broadcast goes out and a rival's `cell:lock` is then `ACQUIRED` — i.e. the bay
really is free to everybody, not merely announced as free.

### Why this does not break the reconnect it looks like it should

`doc/decision/0187-*` originally ruled this fix out on the grounds that a
reconnect would answer `HELD_BY_OTHER`. That objection was about `acquire`, not
`release`, and it was retracted in that record before this task began. Nothing
here touches `acquire`.

The reconnect path is safe for the same reason `releaseSocket` is safe: a
renewal re-keys `socketId`, so the connection that eventually closes the form is
always the one that owns the hold. `useCellLock` re-requests the hold on the new
connection *before* it could ever release it — the request is the effect's
setup and the release is its cleanup — so there is no ordering in which a live
form releases through a socket the server does not have recorded.

There is no per-user single-hold constraint anywhere in `LockService` or the
gateway that this could interact with: `locks` is keyed by cell, `acquire`
compares `holder.id` for one cell at a time, and `releaseSocket` walks the map.
A user may hold as many cells as they have forms open, before and after.

### What it costs

A superseded connection now gets `false` where it used to get `true`, and the
gateway broadcasts `cell:unlocked` only on `true`. So a second tab that closes
its dialog no longer tells the room anything — correctly, because the cell is
still held. Its own tile is already correct: `useCellLock` sets `IDLE` locally
in the same cleanup regardless of what the server answers, and it has no
acknowledgement to be misled by (the contract declares one for `cell:lock`
only).

**This fixes one direction of the two-tab hazard and not the other, and the
difference matters enough to tabulate.** Ownership is by user, so two tabs of
one user on one cell both believe they hold it and their heartbeats hand
`socketId` back and forth:

| what happens | before | after |
| --- | --- | --- |
| the tab that opened **first** closes its dialog | drops the hold the second tab is showing | refused — it is not the recorded connection |
| the tab that opened **second** closes its dialog | drops the hold the first tab is showing | **unchanged: still drops it** |

The second row is not an omission and cannot be fixed here: that tab's
`cell:lock` was a renewal that re-keyed the hold onto its own socket, so its
`cell:unlock` *is* a release by the recorded owner. Refusing it would mean
changing `acquire`, which is the thing that makes a reconnect a renewal.

Exercised rather than argued —
`realtime.gateway.spec.ts`, "still lets the newest connection of a user drop a
hold their older tab is showing": the `cell:unlocked` broadcast count is 1 and a
third user's `cell:lock` answers `ACQUIRED`, while the older connection's dialog
is still open. Its counterpart in the same file asserts the opposite for the
superseded direction. Both pass, and the pair is the honest statement of what
this change bought.

What is left is a courtesy lock behaving as a courtesy lock, bounded by the
renewal heartbeat (half a TTL, ~15 s), and it is written up for a product owner
in `doc/realtime.md` §"Known residual: one user, two tabs, one bay".
`reservation.create` re-checks everything and the unique indexes are what
enforce correctness.

## How

- `apps/garage/api/src/realtime/lock.service.ts` — the abstract signature, the
  in-memory match, the Redis mapping table (`DEL` only if the holder **and its
  socket** match), and a new header section stating the asymmetry.
- `apps/garage/api/src/realtime/realtime.gateway.ts` — `cellUnlock` passes
  `{ user: client.data.user, socketId: client.id }`.
- `apps/garage/api/src/realtime/lock.service.spec.ts` — "refuses a superseded
  connection of the holder's own user" (the hold survives a rival's `acquire`,
  so it is held rather than merely unreported) and its pair, "lets the
  connection that re-took the hold give it back", which is what would fail if
  the match were tightened to socket **only**.
- `apps/garage/api/src/realtime/realtime.gateway.spec.ts` — the same claim over real
  sockets: no `cell:unlocked` reaches the room, and the rival is still
  `HELD_BY_OTHER`.

## Risk

- **A client that reconnects without re-requesting would strand its hold.** No
  such client exists — `useCellLock` re-requests on every `socket`/status change
  — but a future one that held state across a reconnect would now be unable to
  release, and would have to wait out the TTL. The TTL is the backstop and is
  short (~30 s) for exactly this class of reason.
- **The Redis upgrade path gains a field.** The Lua guard on release now has to
  compare the socket id as well as the holder. That is one more value in the
  stored payload, not a new mechanism, and `releaseSocket`'s per-socket key set
  already implies it is stored.
