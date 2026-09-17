# 0132 — The per-attempt Slack timeout is `SlackClient`'s own timer, not axios's

**Date:** 2026-09-03 · **Status:** accepted · **Task:** 16 (fix round 2)

## What

`DefaultSlackWebClientFactory` now constructs its `WebClient` with `timeout: 0`
— axios's own numeric per-request timeout, disabled. `SlackClient.withRetries`
races every attempt against its own `setTimeout`, and the instant that timer
fires it calls `AbortController.abort()` on the attempt's controller, wired
into the `WebClient`'s axios instance through the `requestInterceptor`
constructor option (the SDK exposes no per-call `signal` parameter). The abort
runs before the failure is classified, logged, or backed off — before anything
else in the catch path — so it always reaches the connection before the retry
goes out.

## Why not just pass `timeoutMs` to axios and abort in the `catch`

That was the first version of this fix, and it was wrong in a way that only
showed up under mutation testing. axios's own `timeout:` option, on firing,
tears the connection down through `req.destroy()` — the *exact* function an
externally supplied `AbortSignal` also triggers (confirmed by reading
`axios/lib/adapters/http.js`: both paths call the same internal `abort()`
closure). Passing `timeoutMs` to `WebClient` **and** wiring an explicit
`AbortController` in `withRetries`'s `catch` block means two mechanisms doing
the identical teardown, and the second one is redundant with the first. A
redundant mechanism cannot be mutation-tested: deleting the explicit
`controller.abort()` call left every test green, including a purpose-built
one using an 8 MB body and a paused fake-server socket to force a genuine
still-sending timeout — because axios's own timeout had already destroyed the
connection regardless.

Moving the timeout itself into `SlackClient` — disabling axios's copy
entirely — makes the abort the *only* thing that can ever tear a timed-out
attempt's connection down. With axios's own timeout removed, deleting
`controller.abort()` in `withRetries` reliably turns that same test red
(`server.requests` goes from length 1 to length 2 — the held attempt
completes on the wire after its retry already succeeded). That failing-when-
mutated test is the proof the fix is load-bearing, matching this project's
mutation-campaign discipline (`task-16-report.md`).

## Why the deterministic reproduction needed an oversized body, not just a
   paused server

An earlier version of the same test used a tiny body and only paused the fake
server's read of it. That reproduces "the server hasn't looked at this
connection yet" but not "the request is still in flight": a small body has
typically already been fully written to the OS socket buffer by the time any
realistic timeout fires, so — regardless of any abort — the peer's kernel may
already hold it complete, and TCP's own close semantics for an
already-fully-delivered byte stream are not something either axios or this
code controls. That version of the test could not discriminate the two
implementations described above; it passed either way.

`SLACK_REQUEST_TIMEOUT_MS`-scale timeouts (measured in tens to low hundreds of
milliseconds) paired with a body sized to exceed a loopback socket's send and
receive buffers (`OVERSIZED_TEXT`, 8 MB — buffers are typically well under 1
MB) force TCP flow control itself to stall the client's write once the fake
server's paused receive window fills: the unsent remainder genuinely never
leaves the client process. That is a property of the protocol, not of
scheduling luck, which is what makes the resulting test deterministic rather
than a hope that a shared event loop happens to starve in the right order —
the same trap that hid the original bug behind an isolated test passing 20/20
while a 4-way concurrent stress run failed 13/20 (see `task-16-report.md`'s
round-2 section for both runs).

## What this still does not guarantee

Aborting the loser of the race stops it from being read *by this test's fake
server, held open specifically to observe that*. It cannot un-send a request
that had already reached the real Slack and been accepted before the timeout
fired — nothing running on this side of the network can. The guarantee this
buys is **at-least-once, with the loser of a lost race torn down as soon as it
is known to have lost** — not exactly-once. `doc/slack.md` §4 states this
explicitly, replacing an earlier framing (task-16-task-review.md, fix round 2)
that implied more than the code, or any client-side timeout policy, can
actually promise.

## Consequences

- `SlackWebClientFactory.create()`'s options no longer include `timeoutMs`: no
  implementation of it needs the value now that the timeout lives entirely in
  `SlackClient`. A future factory that still wanted axios's own timeout would
  be reintroducing the redundant-mechanism trap above.
- The synthetic timeout error `SlackClient` now constructs carries
  `code: ErrorCode.RequestError`, the same code axios's own timeout would have
  produced, so `describeSlackFailure` classifies it identically (retryable,
  logged as `slack_webapi_request_error`) and no other test's assertions on
  that shape needed to change.

## How

- `apps/garage/api/src/slack/slack-client.service.ts` — `DefaultSlackWebClientFactory`
  (`timeout: 0`, `requestInterceptor`), `SlackClient.attempt` (the race and the
  abort).
- `apps/garage/api/src/slack/testing/slack-test-server.ts` — `holdNextRequest`.
- `apps/garage/api/src/slack/slack-client.service.spec.ts` — "a timed-out attempt
  that is still in flight when the retry fires".
- `apps/garage/api/src/slack/slack-web-client-factory.spec.ts` — the interceptor
  actually attaches and clears the signal it is given.
- `doc/slack.md` §4.
