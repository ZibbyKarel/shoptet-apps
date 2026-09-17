# 0051 – Concurrent token renewals are coalesced in-process only; the cross-process race is accepted for the MVP

*(“in-process” now means the whole process, which is the point of the rewrite
below — it used to mean “one of the three bundles Next.js builds”.)*

**Date:** 2026-09-02 · **Rewritten:** 2026-09-03 · **Status:** accepted · **Task:** 20 (`libs/garage/auth`), review fix round 1; rewritten in the final-review fix round
**Follows on from:** `doc/decision/0044-*` (a failed refresh signs the user out)
**Mechanism now lives in:** `doc/decision/0245-*` · **Same root cause:** `doc/decision/0231-*`

> **What changed in the rewrite.** The first version of this record said the
> refresher closure "is created once per server process and shared by every
> request that process handles", and rested its whole "why in-process coalescing
> is worth doing" section on that. **It was false**, and it was falsified inside
> this repository two tasks later, by `doc/decision/0231-*`: Next.js builds
> three auth configurations in one `next start`, so there were three refreshers
> with three private in-flight slots. Residual case 1 below — "more than one
> process" — was already true *within* one process. The final review measured
> two token grants where this record promised one. The code has since been
> fixed (`doc/decision/0245-*`); this record is rewritten to describe what is
> now true, and to keep the wrong claim visible rather than quietly deleted.

## What

`createTokenRefresher` coalesces the **in-flight** token request, keyed by the
refresh token that started it: a caller arriving with the same refresh token
while a grant is on the wire gets that same promise instead of sending a second
grant. The slot is cleared as soon as the request settles — this coalesces
callers, it does not cache a result.

The slot does **not** live in a closure. It lives in a `TokenRefreshState`
anchored to `globalThis` under a `Symbol.for` key, keyed by issuer and client id,
so all three of the auth configurations Next.js builds share it
(`doc/decision/0245-*`). The discovery-document promise is shared the same way.

The race across *separate processes* is **not** solved and is accepted for the
MVP.

## Why

**The race.** `jwt` runs on every session read, and one page load can produce
several: a root layout, a Server Component and a Route Handler each calling
`await auth()` is three, and the browser's `/api/auth/session` poll can land on
top. They read the **same request cookie**, so if they fall inside the 60-second
renewal window they each hold the same refresh token. With refresh-token rotation
enabled on the authorization server the first grant succeeds and **invalidates**
that token; the rest come back `invalid_grant`, `markRefreshFailed` fires,
`error: 'RefreshTokenError'` is written by whichever response sets the cookie
last, and `useRequireAuth` signs the user out mid-session.

The direction of failure is right — the session fails closed and no stale bearer
is ever sent (`doc/decision/0044-*`). What is wrong is the **frequency**: a user
gets bounced to Okta for no visible reason, intermittently, and only in
production, because `mock-oauth2-server` does not rotate refresh tokens.

**Why the coalescing has to be process-wide and not per closure.** This is the
paragraph the original record got wrong. `apps/garage/web/src/auth.ts` calls
`createAuth()` at module scope, which would be once per process if a process had
one module registry. It does not. Next.js compiles the proxy, the `/api/auth/*`
route handlers and the server components into separate bundles, each with its own
registry, so `createAuth()` runs **once per bundle** — three times in one
`next start`, measured with instrumentation in the running process
(`doc/decision/0231-*`) and confirmed from the committed `.next`, which carries
three server chunks each with its own copy of the module.

The two callers most likely to race are on *different* bundles: the proxy and the
root layout. A per-closure slot therefore coalesced exactly the pairs that do not
collide and none of the pairs that do. Measured, two `createAuthConfig()`
instances with one refresh token: **two grants, two discovery requests**, where
this record promised one of each.

`globalThis` is what crosses the bundle boundary, because all three run in the
same V8 realm — which is true here precisely because the proxy runs on the
Node.js runtime (`doc/decision/0100-*`). The full reasoning, the key, and the
tests are in `doc/decision/0245-*`.

**Why not more than that.** A correct cross-*process* fix needs a lock and a
place to put the renewed tokens that all processes can read. `plan.md` mandates
the `LockService` abstraction precisely so that this class of problem has one
home, and mandates equally that the MVP ships no Redis. Inventing a second,
auth-specific coordination mechanism here would pre-empt that decision from the
wrong layer.

**Alternative rejected: cache the result briefly.** Holding the last successful
`RefreshedTokens` for, say, 30 seconds keyed by the *consumed* refresh token
would also rescue a straggler that read the cookie before the winner's
`Set-Cookie` arrived. It was rejected: it means keeping a live access token and a
rotated refresh token in process memory beyond the request that needed them, for
a benefit that only shows up in a narrower window than the one coalescing already
covers. Keeping tokens no longer than necessary is the same rule
`doc/decision/0043-*` applies to the browser.

**Alternative rejected: retry once on `invalid_grant`.** The retry would present
the same dead token, so it cannot succeed. Reading the cookie again mid-callback
to pick up the winner's tokens is not possible either — Auth.js hands the `jwt`
callback the token it decoded at the start of the request.

## How

`libs/garage/auth/src/lib/refresh.ts`: the returned function checks
`state.inFlight?.refreshToken` before starting an exchange, and clears the slot on
settle only if it is still the current entry (so a slow failure cannot wipe a
newer renewal's slot). `state` is `sharedRefreshState(issuer, clientId)` in
production and a private bag in tests.

Exercised in `refresh.spec.ts`, with the token responses held open by a gate so
the second caller genuinely arrives mid-flight rather than in the same tick:

- two callers with the same refresh token produce **one** grant and identical
  results;
- two callers with *different* refresh tokens produce two grants — one session's
  tokens must never be handed to another;
- **two separate refreshers over one shared state produce one grant**, which is
  the arrangement production actually has and the one the first version of this
  record never tested;
- two refreshers with *separate* state produce two grants — the counterfactual,
  and what the closure version did in production;
- a second renewal after the first has settled makes its own request (coalescing,
  not caching);
- a failed renewal clears the slot, so the next attempt is not stuck on a
  rejected promise.

And in `config.spec.ts` › *sends one grant when two configurations renew the same
token at once*, which drives the **wired** `jwt` callbacks of two
`createAuthConfig()` instances — because the defect could just as easily be a
missing wire as a wrong rule.

Probed by mutation: deleting the `inFlight` check makes the first of those fail
with `Expected: 1 / Received: 2`; removing the `state:` argument in `config.ts`
makes the wired test fail with `Expected length: 1 / Received length: 2`.

## Risk if this is wrong

**The residual race is smaller than it was, and still real.** Two cases survive:

1. **More than one process** — `next start` under a process manager with several
   workers, a Node worker thread, or two instances behind a load balancer.
   `globalThis` is per V8 realm, so each gets its own table and the original race
   returns in full. This is the case `LockService` is for, and it is the upgrade
   path: when the deployment stops being single-instance, the renewal has to take
   a distributed lock keyed by the session's `sub` before exchanging, and publish
   the result. *(This is the case that, before `doc/decision/0245-*`, was already
   true inside a single process.)*
2. **A straggler in the same process** — a request that read the cookie *before*
   the winner's renewal, and calls `refresh` after it settled. It presents the old
   token, gets `invalid_grant`, and is signed out. Narrow — near-simultaneous
   `auth()` reads almost always land *during* the flight, which is what
   coalescing covers — but not impossible.

**Operational consequence: keep refresh-token rotation switched off on the Okta
authorization server.** This precondition **still stands after the fix**, and
saying otherwise would be the same mistake this record is being rewritten for.
What has changed is its weight. Before `doc/decision/0245-*` it was the only
thing standing between a rotating issuer and a mid-session sign-out on
essentially every page load inside the renewal window, because the two bundles
most likely to race never coalesced at all. Now it defends case 2 above, and case
1 if the deployment ever stops being single-instance.

It is still **not enforced by anything in this repo**, and cannot be — it is
Okta-side configuration that no code here can read. It belongs in the deployment
checklist, and this record plus `doc/decision/0245-*` are the reference for why.

Nothing tests the residual race, because reproducing it needs two processes and a
rotating issuer, neither of which exists in this workspace. Task 28's e2e will not
catch it either (`mock-oauth2-server` does not rotate). It is recorded here rather
than guarded.
