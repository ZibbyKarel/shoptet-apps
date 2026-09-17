# 0110 – The cell-lock TTL is 30 s, it comes from the environment, and the client's renewal budget fits inside it

**Date:** 2026-09-03 · **Status:** accepted · **Task:** 15 (the Socket.io gateway)

## What

`REALTIME_LOCK_TTL_MS`, an added key on `apiEnvSchema` with a default of **`30_000`**.
`InMemoryLockService` reads it once, at construction, and every hold — fresh or renewed —
lasts exactly that long.

Task 21 flagged that its client-side constants were sized against an *assumed* ~30 s server
TTL and that "the constant should be revisited when Task 15 fixes the TTL"
(`doc/decision/0062-*`, §Risk). This is that fix, and the answer is: **the assumption was
right, and the three client constants stand unchanged.**

| constant | where | value |
| --- | --- | --- |
| `REALTIME_LOCK_TTL_MS` | `apps/garage/api/src/env.ts` | 30 000 ms |
| `CELL_LOCK_RENEW_FRACTION` | `libs/garage/realtime-client` | 0.5 |
| `CELL_LOCK_ACK_TIMEOUT_MS` | `libs/garage/realtime-client` | 5 000 ms |
| `CELL_LOCK_ACK_ATTEMPTS` | `libs/garage/realtime-client` | 2 |

The interleaving, on a hold taken at *t*=0:

```
t=0      cell:lock  → ACQUIRED, expiresAt = 30 000
t=15 000 renewal sent          (RENEW_FRACTION × remaining)
t=20 000 …no ack: attempt 2    (+ ACK_TIMEOUT_MS)
t=25 000 …no ack: give up → idle
t=30 000 the server's hold lapses, and cell:unlocked is broadcast
```

Two attempts of 5 s resolve by ~25 s, inside the same TTL, with 5 s of margin. The client
gives up **before** the server does, which is the safe direction: it drops to `idle` — an
honest "this client does not know that it holds the cell" — rather than asserting a hold the
server is about to release.

## Why 30 s, and not something else

The number is bounded from both sides, and the window is not large.

**Below ~15 s it breaks the client.** The renewal falls due at half the TTL and then gets two
5 s attempts, so the client's own budget consumes 10 s after the halfway point. At a 15 s TTL
the second attempt lands at 17.5 s — *after* the hold has already lapsed, so a single dropped
packet would produce a form that gives up on a hold it still had. Anything below ~20 s starts
eating the margin.

**Above ~60 s it breaks the user.** The TTL is how long a tile reads "právě upravuje …" after
somebody closes their laptop mid-edit, on the paths where no `cell:unlocked` arrives — a
process kill, a lost socket the server has not yet noticed. A minute of a spot looking taken
when it is free is a spot nobody reserves.

30 s sits in the middle of that band and costs one renewal per open form per 15 s, which for
a lot of this size is nothing.

## Why it is configurable at all

So that the specs can run the *same* gateway against a short TTL. `apps/garage/api/src/realtime/**`
contains no `NODE_ENV` check, no test flag and no bypass; the only thing that differs between
a spec and production is this value — exactly the rule `apps/garage/api/src/auth` follows for
`AUTH_OKTA_ISSUER`, and the reason `realtime-no-backdoor.spec.ts` asserts the module reads
this one key and mentions no environment name at all.

Without it, "the hold lapses and `cell:unlocked` is broadcast" would be a 30-second test, or
an untested claim. It is neither.

## Why the client does **not** get a copy of this number

`useCellLock` schedules its renewal from the server's own `expiresAt`, not from a TTL constant
compiled into the browser. So an operator who changes `REALTIME_LOCK_TTL_MS` gets a client
that is immediately correct for the new value, and there is no second number for two tasks to
keep in sync. The client's constants above are a *budget*, not a copy of the TTL — which is
why this decision only has to check that the budget still fits, not that two numbers still
match.

## How it is verified

- `lock.service.spec.ts` — "grants a free cell, with a deadline one TTL out", "reads its TTL
  from the environment rather than a constant", and the renewal tests, which advance the clock
  by exactly `TTL / 2` (the client's renewal moment) and assert the hold survives past the
  original deadline and still lapses eventually.
- `realtime.gateway.spec.ts` — the acknowledgement's `expiresAt` is asserted to be one TTL out
  from real wall-clock time, over a real socket.
- `env.spec.ts` — the default is `30_000`.

## Risk if this is wrong

**A deployment that sets this below ~15 s silently degrades the client** into "form drops to
idle while the hold was still live". Nothing fails; the user just loses the tile state
occasionally. The mitigation is that the key is documented in `doc/environment.md` with a
pointer here, and the arithmetic above is written out rather than left for somebody to redo.

**The 5 s ack timeout is still unmeasured against real network latency.** It was a guess at
Task 21 and it remains one — what this decision establishes is that it is a guess with 5 s of
margin against the TTL, not that 5 s is the right round-trip budget. Fáze 7's e2e is where a
real round trip is first observed.
