# 0048 – A failed refresh drops the token and signs the user out, rather than retrying or serving a stale bearer

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 20 (`libs/garage/auth`)

## What

When the `jwt` callback cannot renew the access token, it:

1. **removes** `accessToken`, `expiresAt` and `refreshToken` from the JWT — it does not keep
   the expired ones;
2. sets `error: 'RefreshTokenError'`;
3. **does not retry** on the next request while that flag is set.

Downstream, `accessTokenOf` returns `null` (so `createApiClient` omits the `Authorization`
header entirely), `isAuthorized` returns `false` (so middleware redirects to the sign-in
page), and `useRequireAuth` calls `signOut()` in the browser.

## Why

**A stale bearer produces the wrong error.** Sending an expired token gets a 401 that is
indistinguishable, from the UI's point of view, from a bug in the API or a mis-scoped route.
Sending *no* token gets an unambiguous "unauthenticated", which the app already has one
response to. The spec's phrasing — "a failed refresh leads to sign-out, not a silent 401" —
is about exactly this.

**Retrying a dead credential is worse than failing.** A refresh token is usually unusable for
a permanent reason: revoked, rotated by another tab, or the user removed from the Okta app.
Retrying on every request means one token-endpoint call per page load, per tab, forever,
against a credential we already know is dead — a self-inflicted denial of service on the
identity provider, and one that hides the real state from the user.

**`signOut`, not `signIn`.** The Auth.js guide suggests `signIn(provider)` to force
re-authentication. That leaves the broken session cookie in place while the sign-in flow
runs, and if the flow bounces (consent screen, MFA timeout, the same expired grant), the user
lands back on a page that immediately tries again — a redirect loop. Signing out clears the
cookie first; the middleware then sees no session and sends them to Okta from a clean state.

**The middleware callback is the server-side half of the same rule.** `isAuthorized` returns
`false` for a session in the error state, so a navigation never reaches a protected route with
a session it cannot authenticate. Without that, the redirect would depend entirely on a
client hook running.

## How

`markRefreshFailed` in `libs/garage/auth/src/lib/config.ts` builds the new token by destructuring the
three fields away rather than assigning `undefined` — `exactOptionalPropertyTypes` is on, so
an optional property either holds a value or is absent. `projectSession` likewise rebuilds
`accessToken` from the token rather than merging, which is what makes "a stale token cannot
survive a failed refresh" true by construction rather than by ordering.

`rotateAccessToken` returns early (`token.error !== undefined`) before any network call, which
is the no-retry rule.

Exercised in `config.spec.ts`: a failing refresher leaves `error` set with no `accessToken`
and no `refreshToken`; a token with no refresh token fails closed **without** calling the
provider; an already-failed session is returned identically with zero provider calls;
`projectSession` on a session that still carries an old `accessToken` emits one without it;
and one end-to-end run drives the configured callback against a 400 `invalid_grant`, feeds the
result through `session`, and asserts `isAuthorized() === false`.

In `access-token.spec.ts`, a real `createApiClient` issues two calls across a session that
fails in between, and the recorded headers are `['Bearer okta-access-token', null]` — the
header disappears rather than going stale. In `client.spec.tsx`, `useRequireAuth` on an
errored session calls `signOut` once and `signIn` never.

## Risk if this is wrong

A transient failure — the token endpoint briefly unreachable — is treated the same as a
revoked grant, so the user is signed out and has to sign in again. That is a real cost, and
the milder alternative (retry once, then fail) was considered. It was rejected because the
retry would have to live inside a callback that runs on every session read, with no place to
keep a per-session attempt count except the JWT itself — and a counter in the session cookie
is state that has to be reasoned about on every path that writes the token. Signing out is
recoverable in one click; the renewal skew of 60 s already makes a momentary outage unlikely
to coincide with the last chance to renew.

The second risk is a redirect loop from the other direction: if Okta consistently refuses to
issue a session, `signOut` → middleware → Okta → callback → `signOut` could cycle. That path
is not exercised here; it belongs to Task 23, which owns the sign-in page and is where a
"sign-in failed" screen would live.
