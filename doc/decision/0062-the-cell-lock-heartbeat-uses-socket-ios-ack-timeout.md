# 0062 – The cell-lock heartbeat uses Socket.io's ack timeout, so a lost acknowledgement cannot end it

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 21 (`libs/garage/realtime-client`, fix round 1)

## What

`useCellLock` sends `cell:lock` through `socket.timeout(...)` instead of a bare `emit`:

```ts
socket.timeout(CELL_LOCK_ACK_TIMEOUT_MS).emit('cell:lock', cell, (error, raw) => {
  if (disposed) return;
  if (error) {
    unanswered += 1;
    if (unanswered < CELL_LOCK_ACK_ATTEMPTS) { request(); return; }
    held = false;
    setState(IDLE);
    return;
  }
  unanswered = 0;
  …
});
```

Two new exported constants: `CELL_LOCK_ACK_TIMEOUT_MS = 5_000` and
`CELL_LOCK_ACK_ATTEMPTS = 2` (the attempt plus one retry). A lost acknowledgement is retried
once; a second loss drops the hook to `idle`. Any acknowledgement resets the budget.

No contract change: `cell:lock` and its ack are exactly as `@garage/contract/realtime`
already declares them. `.timeout()` is a client-side ack timer, invisible to the gateway.

## Why

**The heartbeat was one dropped packet away from stopping for good.** The next renewal is
scheduled from inside the ack callback (`renewal = setTimeout(request, renewDelayMs(...))`),
and `socket.emit(event, payload, cb)` in Socket.io has **no** timeout unless `.timeout()` is
used: a callback whose ack never arrives is simply never called. So a single lost ack ended
the chain permanently, and the failure was completely silent — exercised before the fix, ten
further minutes of virtual time produced no retry, with the state frozen at `held` and an
`expiresAt` long past.

The consequence is the exact experience the lock exists to prevent:

> Two colleagues open the same cell. User A holds the lock; one renewal ack is dropped by a
> flaky proxy. A's client still shows `held` and its form stays open; the server's TTL lapses
> and releases the hold. User B's tile clears, B takes the lock and submits. A submits into a
> `CONFLICT` from `reservation.create` with no warning.

Symmetrically, a lost *first* ack left a form sitting at `requesting` forever, showing the user
nothing at all.

**The comment already promised the fix.** `CELL_LOCK_RENEW_FRACTION`'s doc comment said the
half-TTL exists so that *"a renewal that is lost in flight still leaves a second attempt inside
the same TTL"*. There was no second attempt. Of the two ways to make the code and the comment
agree — implement the retry, or delete the claim — implementing it is right, because the
comment describes the intent behind a number that is otherwise arbitrary. Half a TTL only buys
slack if something uses the slack.

**Why `.timeout()` rather than a hand-rolled timer.** A parallel `setTimeout` next to the emit
would have to be cleared on the ack, on the cleanup, and on the retry, and would have to keep
its own map from ack id to timer — which is what `Socket._registerAckCallback` already is. The
library's timer also removes the packet from `sendBuffer` and deletes the ack entry, so a
timed-out renewal does not get flushed onto the *next* connection where it would mean something
else. Reimplementing that is how a wrapper drifts from the library it wraps.

**Why two attempts and not more.** The retry is the "second attempt inside the same TTL", and
the sizing is what makes that literally true: against the shortest TTL the gateway is expected
to use (~30 s, renewal at ~15 s), two 5 s attempts resolve by ~25 s — inside the same TTL, with
margin. A third attempt would not be. Beyond that, a gateway that has answered nothing for
10 s is not going to start because a form kept asking, and an uncapped retry on a contended
cell is the traffic the `cell:unlocked` broadcast exists to avoid.

**Why giving up means `idle` and not a frozen `held`.** A UI asserting a hold the server has
stopped confirming is the defect, not the mitigation. `idle` is honest: this client does not
know that it holds the cell. No `cell:unlock` is sent on the way out either, for the same
reason none is sent on a dropped socket — this client's exchange is not being answered, so the
server's TTL is what releases the hold.

## How it is verified

`libs/garage/realtime-client/src/lib/cell-lock.spec.tsx`, four new tests, all driving a real
`socket.io-client` socket whose transport is replaced but whose acknowledgement registry and
ack timer are its own. Jest fake timers are installed before the manager is constructed, so the
`setTimeoutFn` the manager binds is the fake one and the library's real ack timer is what the
tests advance.

| test | claim |
| --- | --- |
| "re-sends a renewal whose acknowledgement never comes back" | a third `cell:lock` after the timeout, still inside the TTL, still `held` |
| "keeps the heartbeat going once a retried renewal is answered" | the budget resets: the next lost ack gets its own retry |
| "drops to idle rather than claiming a hold the server stopped confirming" | `1 + CELL_LOCK_ACK_ATTEMPTS` emits, then `idle`, then nothing for four further TTLs |
| "does not leave a form stuck at \"requesting\" when the first ack is lost" | the initial request resolves to `idle`, not a permanent `requesting` |

**Mutation.** Restoring the pre-fix `socket.emit('cell:lock', cell, (raw) => …)` — no
`.timeout()`, no error branch — fails **4 of 69** tests: exactly the four above.

## Risk

**5 s is a guess against a TTL that does not exist yet.** The gateway (Task 15) sets the real
TTL and the real round-trip latency is unmeasured. If the TTL turns out much shorter than 30 s,
two 5 s attempts could outlive it and the hook would give up after the hold had already lapsed
— the visible symptom is a form dropping to `idle`, which is a safe direction to fail in, but
the constant should be revisited when Task 15 fixes the TTL. It is one exported number.

**A slow gateway is now indistinguishable from a lost packet.** A `cell:lock` answered after
5 s counts as lost and is re-sent; the server sees two lock requests for the same cell from the
same client, which the contract says is a renewal and therefore harmless. The late ack arrives
to a deleted entry and is dropped by the client (`onack` logs `bad ack` in debug builds and
returns).

**Pending ack timers outlive a cleaned-up effect.** Unmounting mid-flight leaves the library's
5 s timer running; it fires into the `disposed` guard and does nothing. Bounded and harmless,
but it is why the guard is the first line of the callback rather than a later branch.
