# 0063 – Transport reconnection stays unlimited; only handshake refusals have a ceiling

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 21 (`libs/garage/realtime-client`, fix round 1)

## What

`createRealtimeSocket` passes no reconnection options, so Socket.io's defaults apply to
**transport** failures:

| option | default (`manager.js`) |
| --- | --- |
| `reconnection` | `true` |
| `reconnectionAttempts` | `Infinity` |
| `reconnectionDelay` | `1000` ms |
| `reconnectionDelayMax` | `5000` ms |
| `randomizationFactor` | `0.5` |

This is now a recorded decision rather than an unexamined default, and it is stated next to
its opposite: **handshake refusals are capped at three automatic attempts**
(`doc/decision/0061-*`). The two policies are deliberately different.

## Why

**The defaults are already the policy this project would write.** Exponential backoff from 1 s
to 5 s with ±50 % jitter is the standard shape, and the jitter is the part that matters for a
single-instance deployment: it is what stops every tab in the office retrying in lockstep.
Restating the numbers in `createRealtimeSocket` would create a second place for them to drift
from the library's, with no behavioural gain.

**Unlimited is right for a transport failure specifically.** The failure mode is "the gateway
is not reachable" — a deploy, a laptop lid, a WiFi handover, a proxy restart. Every one of
those is temporary by nature, and the correct client behaviour is to keep waiting. A ceiling
here would mean a tab that had been asleep through a two-minute deploy comes back to a dead
page that only a reload fixes, which is precisely the defect `doc/decision/0061-*` exists to
remove. Giving up on a connection that would have worked is worse than the cost of asking.

**Unlimited is wrong for a refused handshake, which is why that case is capped.** A refusal is
the gateway *answering*, and answering no. Re-presenting the same credential in a loop is a
request that cannot succeed, and it makes the JWKS validation path the busiest thing on a
single-instance deployment. The asymmetry is the decision: retry forever what might work, stop
retrying what has already been refused.

**The thundering-herd cost is accepted, with its size stated.** When the API returns from a
deploy, every open tab reconnects within the next 1–5 s window. At this company's headcount —
an internal parking app, tens of tabs — that is tens of handshakes over a few seconds, each one
a JWKS-cached JWT verification. `libs/shared/api-client`'s HTTP traffic on the same page dwarfs it.
The jitter spreads even that. If the office ever grew by an order of magnitude the lever is
`reconnectionDelayMax`, not an attempt ceiling: slowing the herd down is the fix, giving up on
it is not.

**What was rejected.** `reconnectionAttempts: N` for the transport case. It converts a
recoverable outage into a manual reload, and it would need a UI affordance to escape from —
the same affordance `rejected` already has, spent on a case that does not need it.

## How it is verified

Not by a numeric assertion — asserting `reconnectionAttempts === Infinity` would be a test of
the library's default, not of this lib. What is exercised is the behaviour that depends on the
policy:

- `connection.spec.tsx` "leaves a dropped transport alone — socket.io retries that one itself":
  a `connect_error` with the socket still `active` stays `connecting` and builds no replacement
  socket, and an hour of virtual time later there is still exactly one socket. That is the
  positive proof that the transport path is left to the library.
- `connection.spec.tsx` "opens exactly one socket and follows its status" and `useDayRoom`
  "joins the day room once connected, and rejoins after a reconnect": the socket survives a
  drop and re-open, which is the lifecycle the unlimited loop drives.
- `doc/decision/0061-*`'s "stops rebuilding after a bounded number of attempts" is the other
  half — it is what proves the two policies are actually different in code.

## Risk

**A gateway that is down for hours is retried for hours.** Every open tab, once per 5 s, plus
whatever `libs/query` is polling. It is bounded per tab and cheap per request (a failed
connect, no JWT work), so the cost falls on the browser rather than the server. Acceptable at
this scale; the first symptom if it is not would be gateway connect logs, and the fix is
`reconnectionDelayMax`.

**These defaults are the library's, so a socket.io upgrade could change them.** They are not
pinned in this repo. The mitigation is that nothing in this lib's behaviour depends on the
exact numbers — only on "the transport retries by itself", which is `reconnection: true` and
would be a breaking change to alter.

**Not exercised against a real network.** A simulated manager `close`/`open` is the same event
the reconnect timer fires, but the timer itself, the backoff and the jitter have not been run
against a real dropped transport. Fáze 7 e2e against `mock-oauth2-server` is where that lands.
