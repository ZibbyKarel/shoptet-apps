# 0061 – A refused handshake is a terminal status, recovered by building a new socket

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 21 (`libs/garage/realtime-client`, fix round 1)

## What

`RealtimeStatus` gains a fourth value, `rejected`, and `RealtimeConnection` gains a
`reconnect()` method.

`useRealtimeConnection`'s `connect_error` handler now branches on `socket.active`:

```ts
const onConnectError = () => {
  if (next.active) {
    setStatus('connecting');   // transport failure — socket.io retries it itself
    return;
  }
  setStatus('rejected');       // the gateway refused the handshake; the socket is dead
  const delay = REJECTED_RETRY_DELAYS_MS[refusalsRef.current];
  refusalsRef.current += 1;
  if (delay === undefined) return;
  retry = setTimeout(() => setGeneration((n) => n + 1), delay);
};
```

Bumping `generation` is in the connection effect's dependency list, so it tears the dead
socket down and builds a fresh one — which re-runs the handshake `auth` callback
(`doc/decision/0060-*`) and therefore presents whatever access token the provider has **now**.

The recovery policy:

| | |
| --- | --- |
| automatic attempts | 3, at 1 s / 5 s / 30 s after each refusal (`REJECTED_RETRY_DELAYS_MS`) |
| counter reset | on any successful `connect` |
| after the attempts are spent | status stays `rejected`; nothing retries |
| manual escape | `reconnect()` — resets the counter and rebuilds immediately |
| transport failures | untouched: still `connecting`, still socket.io's own unlimited loop |

## Why

**`connect_error` is two different failures wearing one name, and only one of them is
survivable on its own.** For a transport that could not be established, socket.io's reconnect
timer will try again; reporting `connecting` is right. But when the gateway's namespace
middleware refuses the handshake it sends a CONNECT_ERROR packet, and `Socket.onpacket`
(`node_modules/socket.io-client/build/cjs/socket.js`) calls `this.destroy()` **before**
emitting `connect_error`. `destroy()` drops the socket's manager subscriptions — the library's
own comment reads *"clean subscriptions to avoid reconnections"* — and calls
`io._destroy(this)`. The socket is finished. It will never send another CONNECT packet, so it
will never present another token.

Before this change the handler reported `connecting` for both. The concrete consequence:

> A user leaves the grid open over lunch. The tab is backgrounded, the transport drops. On the
> reconnect the socket presents the access token it re-reads from the provider — but
> `libs/garage/auth`'s rotation has not run yet and the token is stale. The gateway refuses.
> `socket.io-client` destroys the socket. `libs/garage/auth` refreshes the token perfectly well a
> minute later and **nothing happens**, because the connection effect's dependencies did not
> change. The grid stops receiving `reservation:created`, `useCellLock` never leaves
> `requesting`, the status pill says "connecting" indefinitely, and only a full page reload
> fixes it.

`socket.active` is the library's own verdict on which case this is — it is `!!this.subs`, the
exact field `destroy()` clears — so the branch reads the client's state rather than guessing
from an error message.

**Why rebuild the socket rather than call `connect()` on it.** There is nothing to reconnect:
the manager no longer routes packets to this socket. A new socket is the only path, and it is
also the *right* path, because building one re-runs `auth`, which is the seam a fresh token
arrives through. The token callback exists precisely so a fresh token can be fetched; this is
what finally uses it for the case it was written for.

**Why the retries are bounded when transport retries are not.** A refused handshake has two
causes. One is a stale credential, which fixes itself in seconds and is worth waiting for. The
other is a user who is genuinely not allowed in — a revoked account, a session signed out
elsewhere — and re-presenting a credential the gateway has just rejected is a request that
cannot succeed. An unbounded loop there would hammer the gateway's JWKS validation from every
open tab with a request that is guaranteed to fail, which is the one retry pattern worth
refusing. 1 s / 5 s / 30 s covers a rotation in flight (`doc/decision/0049-*` polls the session
every five minutes, but a rotation already under way lands far sooner) and then stops.

**Why `rejected` is a distinct status rather than reusing `disconnected`.** They call for
different UI. `disconnected` is transient and self-healing; the honest affordance is a quiet
indicator. `rejected` after the attempts are spent is not going to fix itself, and the user has
an action available — sign in again, or press a "Připojit znovu" control that calls
`reconnect()`. Collapsing them would either put a pointless button on a transient state or hide
the only escape from a permanent one. Both `useCellLock` and `useDayRoom` gate on
`status === 'connected'`, so `rejected` already behaves like "not connected" for them without
any change: the cell lock drops to `idle` instead of sitting at `requesting` forever.

**What was rejected.** Weakening the handshake in any way — a retry without a token, an
anonymous fallback, a "the gateway is probably fine" grace period. The gateway refusing is the
gateway working. Nothing here changes what is sent; it changes only whether anything is sent
again.

## How it is verified

`libs/garage/realtime-client/src/lib/connection.spec.tsx`, `describe('a refused handshake')` — five
tests driving a **real** CONNECT_ERROR packet through a real `socket.io-client` socket. The
fixture's `rejectHandshake()` emits `{ type: CONNECT_ERROR, nsp, data: { message } }` on the
manager's `packet` event, which is the channel `Socket.subEvents()` subscribes to; the packet
shape is `socket.js`'s (`packet.data.message` is what it reads to build the `Error`).

The CONNECT_ERROR type **code** is not written down. The client never sends one, so the
existing "make the client emit it and read the code off its own output" trick does not apply;
`discoverConnectErrorType()` instead identifies it by the pair of effects only CONNECT_ERROR
has — it emits `connect_error` *and* leaves the socket inactive. DISCONNECT destroys but emits
`disconnect`; a CONNECT with no `sid` emits `connect_error` but leaves the socket active. The
conjunction is exact, and it is read off the installed library at run time.

| test | claim |
| --- | --- |
| "is terminal, not \"connecting\" — socket.io will never retry it" | `socket.active === false` and the status is `rejected` |
| "is recovered from by a new socket carrying a freshly read token" | a second socket exists after the first delay, and its CONNECT carries the *second* token the provider returns |
| "stops rebuilding after a bounded number of attempts" | exactly `1 + REJECTED_RETRY_DELAYS_MS.length` sockets, and no more after an hour of virtual time |
| "is recovered from on demand by reconnect(), after the attempts are spent" | one further socket |
| "leaves a dropped transport alone — socket.io retries that one itself" | `connect_error` with the socket still active stays `connecting` and builds no second socket |

**Mutation.** Restoring the pre-fix handler (`const onConnectError = () => setStatus('connecting');`,
with no rebuild) fails **3 of 69** tests: the first three rows above. The fourth and fifth pass
under the mutation and are not evidence for this decision on their own — `reconnect()` is
independent of the branch, and the transport case is what the pre-fix code already did.

## Risk

**Three attempts may be too few, or the delays wrong.** Nothing here has run against a real
gateway (Task 15), so the numbers are sized against `libs/garage/auth`'s rotation rather than measured
against a refusal. If the observed pattern in Fáze 7 e2e is that a stale token takes longer than
36 s to refresh, the table is the one thing to change — it is a single exported constant and the
bounded-vs-unbounded shape does not have to change with it.

**`reconnect()` while already connected rebuilds the socket.** It is unconditional by design —
an explicit "try again" that quietly did nothing would be worse — but a consumer that wired it
to something other than a user-initiated control would drop and re-take every room and cell
lock. It is documented on the method; the only intended caller is a `rejected`-state affordance
in `apps/garage/web` (Task 23).

**A gateway that refuses for a reason unrelated to the token still gets three tries.** A
namespace middleware that throws on a transient internal error, for instance, is retried as if
it were a stale credential. Three requests over 36 s is a cost worth paying to avoid needing
the client to classify server-side failures it cannot see; the alternative would be reading the
rejection message, which this lib deliberately does not touch (it can carry the credential).
