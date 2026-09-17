# 0049 – `AuthProvider` polls the session, because rotation only happens when the session is read

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 20 (`libs/garage/auth`)
**Follows on from:** `doc/decision/0044-*`

## What

`AuthProvider` passes `refetchInterval = SESSION_REFETCH_SECONDS` (300) to Auth.js's
`SessionProvider`. Auth.js's own default is `0` — no polling at all. The interval is
overridable per mount (`refetchIntervalSeconds`), and `0` disables it.

## Why

**Refresh token rotation is not a background job.** It lives in the `jwt` callback, which
Auth.js invokes only when something asks for the session: a Server Component calling `auth()`,
a middleware run, or a `/api/auth/session` request from the browser. Nothing in the system
renews a token on a timer.

**An idle tab holding a socket is the case that breaks.** This app's main screen holds a
Socket.io connection open (Task 21) and may sit for an hour without a navigation. With no
polling, no session read happens, the `jwt` callback never runs, the access token reaches
`exp`, and the API drops the connection — the user sees the app go dead without having done
anything. The rotation logic would be present and correct and would simply never fire.

**Five minutes against a 60-second skew.** `REFRESH_SKEW_SECONDS` is 60, so the renewal window
opens a minute before expiry. A poll every 300 s lands inside that window for any token
lifetime above a few minutes, which covers Okta's defaults (an hour) with a wide margin. The
cost is one request per tab per five minutes, answered from the cookie without a network call
to Okta unless the token is actually due.

**Not `refetchOnWindowFocus`.** That is on by Auth.js's default and helps — but it fires only
when the user comes back to the tab, which is precisely not the idle-tab case.

**Why a constant rather than a caller's decision.** The value is coupled to
`REFRESH_SKEW_SECONDS`, which lives in this lib. Leaving it to `apps/garage/web` would put half of
one mechanism in the app and half in the wrapper, and the wrapper's default would still have
to be *something* — Auth.js's `0`, which is the wrong answer.

## How

`SESSION_REFETCH_SECONDS` in `libs/garage/auth/src/lib/client.tsx`, exported so the number is
citable.

Exercised in `client.spec.tsx` against the **real** `SessionProvider`, with fake timers and a
stand-in for `fetch`: after advancing `SESSION_REFETCH_SECONDS * 1000`, exactly one request to
`/api/auth/session` was made and `useAccessTokenProvider()` then hands out the *renewed*
token rather than the original. Without the interval that test fails — Auth.js registers no
timer at all when `refetchInterval` is falsy.

## Risk if this is wrong

Polling costs a request per tab per five minutes. On a single-instance deployment for one
company that is negligible, but it is a real number and it scales with open tabs rather than
with users.

The interval is a fixed constant, not derived from the token's actual lifetime. An identity
provider configured with an access-token lifetime under about six minutes would let a token
expire between polls. Okta's minimum is five minutes, so the margin is thin at that setting;
the failure mode is the one `doc/decision/0044-*` describes — a sign-out, not a stale token —
and the fix would be to shorten the interval or derive it from `expires_in`. Deriving it was
not done now because it would mean plumbing the expiry into the client session, which
`doc/decision/0043-*` deliberately keeps narrow.
