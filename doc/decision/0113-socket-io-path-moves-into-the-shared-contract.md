# 0113 – `SOCKET_IO_PATH` moves into `@garage/contract/realtime`

**Date:** 2026-09-03 · **Status:** accepted · **Task:** 15, fix round 1

## What

`SOCKET_IO_PATH` — Socket.io's own default HTTP endpoint, `/socket.io` — is now declared exactly
once, in `libs/garage/contract/src/realtime/socket-path.ts`, and exported from
`@garage/contract/realtime`. `apps/garage/api/src/realtime/realtime-io.adapter.ts` imports it rather
than declaring its own copy, and `libs/garage/realtime-client/src/lib/socket.ts` derives
`DEFAULT_SOCKET_PATH` — the name existing callers already use — from the same import instead of a
second literal. `apps/garage/api/src/realtime/testing/realtime-test-client.ts`, the hand-built test peer
that dials a real WebSocket against the assembled app, also now builds its URL from the same
constant rather than a third hardcoded `/socket.io/`.

`realtime-io.adapter.spec.ts` (new) and `libs/garage/realtime-client/src/lib/socket.spec.ts` (extended)
each assert their own side's configured path against this one import.

## Why: two literals that agree are not a guarantee

Task 15's original report considered this duplication and judged it acceptable, reasoning that
"both restate the *library's* default rather than choosing a value, so they cannot drift by
accident — only by somebody deliberately changing one." Task 15's review (fix round 1's input)
found that reasoning incomplete: **there were three copies, not two** — the adapter's own
constant, the client's `DEFAULT_SOCKET_PATH`, and a URL literal inside
`realtime-test-client.ts` — and none of the three was cross-checked by a test. Changing the
server's path alone (the review's probe `P2`) failed 44 tests, but only because the test harness
happened to hardcode the *same* literal the adapter did; changing the *client's*
`DEFAULT_SOCKET_PATH` alone would have failed **zero** tests on either side, because nothing in
`apps/garage/api`'s suite reads it and nothing in `libs/garage/realtime-client`'s suite reads the adapter's
value.

A Socket.io path mismatch between server and browser is not a degraded feature — it is a total
realtime outage. The WebSocket upgrade fails at the transport layer, before the gateway's
authentication middleware, the lock service, or any contract schema is ever reached, so nothing
about "authentication is the same code everywhere" or "every payload is validated" protects
against it. Two independently-maintained literals that happen to match today is exactly the
shape of defect this project's mutation-testing discipline exists to catch, and in this case it
could not: there was no mutation that crossed the module boundary to prove the two sides would
actually notice disagreeing.

## Why the contract, and why this was safe to do in a fix round

`apps/garage/api` (`scope:api`) cannot import `libs/garage/realtime-client` (`scope:web`) — verified by the
original report's ESLint probe and re-verified by the review's own probe D
(`@nx/enforce-module-boundaries` refuses it, correctly: the lib's entry point pulls React in). So
the constant cannot live in either existing home without breaking that boundary. It can live in
`@garage/contract/realtime`, which is `scope:shared`, carries no framework-specific
dependency, and both halves already import for the event registries — adding one more export to
an entry point both sides already depend on is not a new dependency edge, only a new symbol on
an existing one.

This is a change to `libs/garage/contract`'s file set, which the original Task 15 report declined to
make on the grounds that it is "a change to another task's file set." The controller for this fix
round ruled explicitly that the risk of a silent realtime outage outweighs that boundary, and
authorized lifting the constant as part of Task 15's fix round rather than waiting for a task that
happens to reopen the contract. No event, payload, or ack shape changed — this is a transport-level
constant, not a realtime event — so `libs/garage/contract`'s own contract-first guarantees (schemas,
`z.infer` types, the `no-orpc.spec.ts` module-graph walk) are untouched by it.

## How the guarantee is now enforced

Not by making the two sides unable to disagree in principle — nothing prevents a future edit from
reintroducing a private literal on one side — but by making that edit fail immediately, on the
side that made it, without needing both processes deployed together:

- `apps/garage/api/src/realtime/realtime-io.adapter.spec.ts` constructs a real `socket.io` `Server`
  through `RealtimeIoAdapter` and asserts `server.opts.path === SOCKET_IO_PATH` (imported from
  the contract).
- `libs/garage/realtime-client/src/lib/socket.spec.ts` asserts `DEFAULT_SOCKET_PATH === SOCKET_IO_PATH`
  (same import).
- `apps/garage/api/src/realtime/testing/realtime-test-client.ts` — the peer every other realtime spec in
  `apps/garage/api` connects with — now builds its connection URL from the same constant, so a real path
  mismatch between the adapter and the contract would also surface as every existing
  `realtime.gateway.spec.ts` / `realtime-handshake.spec.ts` test failing to connect at all, not
  just the two spec files above.

A single test that imports both `apps/garage/api`'s adapter and `libs/garage/realtime-client` in one file is not
possible — that is the same module boundary this decision works around — so the guarantee is
necessarily two tests, one per side, rather than one. That is weaker than an impossible-to-violate
type-level guarantee, but strictly stronger than the "two literals, no test" state this replaces.

## Risk if this is wrong

**A third undetected copy could still appear.** Nothing stops a future file from declaring its
own `/socket.io` literal instead of importing `SOCKET_IO_PATH`; the enforcement here is a test on
each *known* consumer, not a static guarantee that no fourth copy can exist. The mitigation is the
same as for any duplicated literal: a reviewer who sees a Socket.io path string that is not this
import should ask why.

**The value itself did not change.** This decision moves the constant's home; it does not revisit
whether `/socket.io` (Socket.io's own default) is the right path. Changing the value is now a
one-line edit in `libs/garage/contract/src/realtime/socket-path.ts` rather than a coordinated edit across
two packages, which is the point.
