# 0295 – `held-by-other` recovers, by the broadcast **and** by its own timer

**Date:** 2026-09-03 · **Status:** accepted · **Task:** final-review fix round (libs-wrappers,
I-2) · **Follows on from:** `doc/decision/0111-*`, `doc/decision/0124-*`

## What

`useCellLock` (`libs/garage/realtime-client/src/lib/cell-lock.ts`) no longer treats `held-by-other` as
terminal. Two independent things now end it, and both are wired in the hook:

- **`cell:unlocked` for this cell.** `useRealtimeEvent('cell:unlocked', …)` bumps a `contention`
  counter that is an effect dependency, so the broadcast re-runs the hook's one setup — the same
  path a reconnect and a changed cell take, rather than a second way to ask for a hold.
- **the ack's own `expiresAt` passing.** A `setTimeout` scheduled from the `HELD_BY_OTHER`
  acknowledgement, delayed by the new exported `contendedRetryDelayMs`.

Asking again clears `lockedBy` and `expiresAt` and shows `requesting`, because whoever answers
next may be somebody else, or nobody.

## Why this was wrong before

The comment beside the `held-by-other` branch named both recovery paths. The hook subscribed to
neither. Its effect's dependency list contained nothing that changes when the other holder
releases, so once a consumer saw `held-by-other` it stayed there until the form closed, the cell
changed, or the connection cycled.

`doc/realtime.md` advertised exactly that return shape as the documented usage, so a future
consumer following the docs would render a "právě upravuje …" badge that never clears — the
precise failure `cell-lock.ts`'s own module header says the hook exists to prevent.

It reached no user: `apps/garage/web` discards the return value (`lot-screen.tsx:132`) and drives tile
badges from its own `useCellLocks`, which does subscribe and does prune (`doc/decision/0124-*`).
The hook's advertised state was dead code that happened to be wrong.

`cell-lock.spec.tsx`'s "does not poll a cell somebody else is holding" looked like coverage and
was not: it advanced the clock by `TTL_MS * 4` and asserted exactly one emitted packet, pinning
the *absence of polling* while saying nothing about recovery. It passed identically for a correct
implementation and for this one.

## Why fix it rather than narrow the API

The final-review report recommended the other option — drop `held-by-other` and `lockedBy`,
narrow `CellLockState`, delete the row from `doc/realtime.md`. It is smaller, and it matches how
`apps/garage/web` actually uses the hook. It was rejected for two reasons, both measured by grepping the
workspace rather than argued:

1. **Blast radius, almost all of it outside this task's file set.** `held-by-other` is load-bearing
   in prose that justifies *server* behaviour: `apps/garage/api/src/realtime/lock.service.ts:176-177` and
   `realtime.gateway.ts:223-224` explain why there is one expiry timer per hold by saying that
   `useCellLock` "puts a contended cell into `held-by-other` and then **sits still**", and
   `realtime.gateway.spec.ts:524-525` says the same in a test that exists for it. Add
   `doc/wrappers.md:526,558`, `doc/decision/0111-*`'s entire "Why this is not bookkeeping"
   section, `doc/decision/0124-*:41` and `doc/decision/0220-*:78`. Removing the state would have
   left *more* drifted claims than it fixed, in files this task may not touch — the same defect
   class the fix round exists to close.
2. **`doc/decision/0111-*` asked for this fix by name.** Lines 41–46: "The `cell:locked` payload
   carries `expiresAt` precisely so a client *could* clear the state itself … But `useCellLock`
   does not currently do that … a client-side timer on `expiresAt` would make the two
   independent, and neither task should assume the other did it." This is that timer, plus the
   subscription that makes the fast path work.

Building it makes the code agree with the documentation that already exists, rather than
requiring six documents to be rewritten to agree with a narrower hook.

## Why both mechanisms, and why neither is polling

**Both**, because 0111 says in as many words that neither side should assume the other did it. The
gateway's broadcast is the fast, ordinary path; the timer is the backstop for a broadcast that is
never sent (a listener that threw, a clustered deployment where Redis keyspace notifications are
best-effort — 0111's own named weak point) or never arrives.

**Not polling**, and this is the property the old comment was protecting:

- `contendedRetryDelayMs` waits the **whole** remaining TTL, not `renewDelayMs`'s half. Nothing is
  sent while the other client's hold is still valid.
- The broadcast handler fires once per broadcast, only for this cell, and only out of
  `held-by-other`. A cell announced free while this client is `requesting` or already `held` is
  ignored: the exchange in flight is the newer information, and reacting to a broadcast about a
  hold this client owns would tear down a live hold on somebody else's event.
- It terminates. A release wakes every waiting tab, exactly one wins, the losers get a fresh
  `HELD_BY_OTHER` and go quiet again until the next broadcast. There is no state in which a
  packet leads to another packet without a server event in between.

`contendedRetryDelayMs` is floored at `MIN_CELL_LOCK_RENEW_DELAY_MS` for a sharper reason than
`renewDelayMs` is: an `expiresAt` already in the past would schedule a zero-delay timer whose
request is answered `HELD_BY_OTHER` carrying the *same* stale `expiresAt`, which schedules
another. That is a busy loop no other path in this hook can produce.

## How it is verified

`cell-lock.spec.tsx`, against a real `socket.io-client` socket with only its transport replaced
(`__fixtures__/offline-transport.ts`). Six new hook tests plus three on the pure delay function,
and the old "does not poll" test rewritten to advance to `TTL_MS - 1` — it now pins the absence of
polling *while the other hold is valid*, which is a claim that can be false.

Measured by reverting each mechanism separately:

| reverted | tests that fail |
| --- | --- |
| both | 3 — "asks again when the cell it wants is announced free", "asks again when the other hold lapses and no broadcast arrives", "does not keep re-asking once the cell it recovered is its own" |
| the `expiresAt` timer only | 1 — "asks again when the other hold lapses and no broadcast arrives" |
| the `cell:unlocked` subscription only | 2 — "asks again when the cell it wants is announced free", "does not keep re-asking once the cell it recovered is its own" |
| the handler's two guards (cell match, status match) | 2 — "does not re-ask on a broadcast about a different cell", "does not re-ask on a broadcast about a hold it has itself" |

Each mechanism is independently load-bearing, which is the point of having two.

## Consequences and residuals

- `doc/realtime.md` follows the code: the status table says `held-by-other` is not terminal, a new
  "4. A cell somebody else holds becomes askable again" section replaces the old note, and the
  "does not do" section now states the two properties that keep it from being polling.
- **`doc/decision/0111-*:29` and `:42` are now stale in one direction** — they say the hook "has
  no timer on `held-by-other`" and "does not currently do that". It now does. That file is shared
  ground and outside this task's edit set (only `0039` and this range were allocated), so the
  correction is left to the merge controller. Nothing 0111 *decides* changes: per-hold server
  timers are still right, and the expiry broadcast is still the fast path.
- `apps/garage/web` still discards the return value and still drives tile badges from `useCellLocks`.
  That split is `doc/decision/0124-*` and is unchanged; what changed is that the hook's advertised
  state is now true, so a future consumer can rely on it.
