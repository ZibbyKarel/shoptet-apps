# 0245 – The token refresher's in-flight slot hangs off `globalThis`, for the same reason the revocations do

**Date:** 2026-09-03 · **Status:** accepted · **Task:** final-review fix round, shard contract-auth (C-1)
**Supersedes the mechanism in:** `doc/decision/0051-*` (rewritten alongside this)
**Same root cause as:** `doc/decision/0231-*` (the sign-out revocation map)

## What

`createTokenRefresher` no longer keeps `discovery` and `inFlight` in a closure.
They live in a `TokenRefreshState` bag passed in by the caller, and
`createAuthConfig` passes `sharedRefreshState(issuer, clientId)` — a per-(issuer,
client) record anchored to `globalThis` under
`Symbol.for('@garage/auth:token-refresh-state')`.

A refresher built without a `state` still gets a private bag. That is what a test
wants, and it keeps the process-global state named at the call site rather than
reached for from inside a module — the same shape as
`SignOutRegistryOptions.revoked`.

## Why

`doc/decision/0051-*` rested its whole design on one sentence:

> `apps/garage/web/src/auth.ts` calls `createAuth()` at module scope, so the refresher
> closure is created once per server process and shared by every request that
> process handles.

**That is false, and it was falsified inside this repository two tasks after 0051
was written.** `doc/decision/0231-*` measured, with instrumentation in a running
`next start`, **three `createAuthConfig` instances in one process**: Next.js
compiles the proxy, the `/api/auth/*` route handlers and the server components
into separate bundles, each with its own module registry. The final review
confirmed the shape independently from the committed `apps/garage/web/.next` — three
server chunks, each carrying its own minified copy of the module.

So there were three refreshers with three private `inFlight` slots. The review
drove two `createAuthConfig()` instances through the real `jwt` callback with one
refresh token and measured:

```
PROBE RESULT: token grants=2 discoveries=2      (doc/decision/0051 claims 1)
```

**How it reaches a user.** The proxy (`apps/garage/web/src/proxy.ts` → `auth()`) and the
root layout's `await auth()` read the **same request cookie**, so inside the
60-second skew both hold the same refresh token and both exchange it. With
refresh-token rotation enabled — Okta's default for a new authorization server —
the first grant invalidates the token, the second returns `invalid_grant`,
`markRefreshFailed` fires, and `useRequireAuth` signs the user out mid-session.
Once per token lifetime per active user, for no visible reason, in production
only (`mock-oauth2-server` does not rotate).

`globalThis` crosses the bundle boundary because all three bundles run in the
same V8 realm, which is true here because the proxy runs on the Node.js runtime
(`doc/decision/0100-*`). `Symbol.for` rather than `Symbol()` because the global
symbol registry is realm-wide, so two copies of the module resolve the same key.
That is verbatim the reasoning of `0231-*`; this record exists because the same
defect was sitting ten lines away from that fix and was not noticed when it was
made.

**Keyed by issuer and client id.** The refresh token is the key *inside* the
slot, not the key of the slot: one process could in principle serve more than one
authorization server, and sharing a discovery document between two issuers would
send a grant to the wrong token endpoint.

**Why this does not refuse a non-Node runtime the way `sharedRevokedStore()`
does.** That function throws off the Node.js runtime because its failure mode is
a *security control quietly not holding*. This one's failure mode is a redundant
token grant — the behaviour that shipped before this fix. A boot failure would be
the wrong trade for that, and it would be unreachable anyway: `createAuthConfig`
calls `sharedRevokedStore()` on the next line, so a non-Node runtime has already
refused to boot before any refresher exists.

## How

`libs/garage/auth/src/lib/refresh.ts` — `TokenRefreshState`, `sharedRefreshStates()`,
`sharedRefreshState(issuer, clientId)`; `exchange` and the returned `refresh`
read and write `state.discovery` / `state.inFlight`. The discovery reset on
failure now also checks that the promise it is clearing is still the current one,
so a slow failure cannot wipe a newer attempt's cache — the rule the in-flight
slot already followed.

`libs/garage/auth/src/lib/config.ts` — passes `state: sharedRefreshState(...)`, and its
file docblock no longer claims to be "a pure function of its arguments, no
`process.env`, no module-level state". It never was, once `sharedRevokedStore()`
appeared in it; it is less so now. What is still true, and is what the claim was
for, is that nothing here branches on `NODE_ENV` and no configuration value is
read from the environment.

Three tests, each of which fails with the fix reverted:

- `config.spec.ts` › *sends one grant when two configurations renew the same
  token at once* — the wired `jwt` callbacks of two `createAuthConfig()`
  instances, a gated token endpoint so the second genuinely arrives mid-flight.
  With the `state:` argument removed: `Expected length: 1 / Received length: 2` —
  the review's measurement, reproduced as a test.
- `refresh.spec.ts` › *coalesces across the separate refreshers Next.js builds,
  not just within one* — two refreshers over one shared state. With
  `options.state` ignored: `Expected: 1 / Received: 2`.
- `refresh.spec.ts` › *hands the same state to two independent module
  registries* — `jest.isolateModules`, see `doc/decision/0246-*` for why that
  test and not an identity check inside one registry.

## Risk if this is wrong

**The residual race is smaller, not gone.** Of the two cases `0051-*` listed:

1. **More than one process** — unchanged, and still the `LockService` upgrade
   path. `globalThis` is per V8 realm: a second `next start`, a process manager
   running workers, or a Node worker thread would each get their own table.
   `plan.md` states a single-instance deployment; this is the assumption that
   makes the fix sufficient, and it is the one to re-examine before scaling out.
2. **A straggler in the same process** — a request that decoded the cookie
   *before* the winner's renewal but calls `refresh` after it settled presents
   the consumed token and, with rotation on, is signed out. Coalescing covers
   arrivals *during* the flight, which is where near-simultaneous `auth()` reads
   almost always land, but the window either side is not closed.

**So "keep refresh-token rotation switched off on the Okta authorization server"
is still a deployment precondition.** What changes is its weight: before this
fix it was the *only* thing standing between a rotating issuer and a mid-session
sign-out on essentially every page load in the renewal window, and `0051-*`
itself admitted "it is not enforced by anything in this repo". Now it defends
case 2 alone. It remains unenforced — it is Okta-side configuration, which no
code here can read — so it belongs in the deployment checklist, and this record
is the reference for why.

**`globalThis` is shared with everything else in the process.** The symbol is
namespaced to this package, which makes a collision implausible and not
impossible — the same residual `0231-*` records for the revocation key.
