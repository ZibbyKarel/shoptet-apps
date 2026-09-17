# 0047 – The access token crosses to the browser; the refresh token never does

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 20 (`libs/garage/auth`)

## What

The `session` callback (`projectSession`) copies **only** `accessToken` and `error` from the
JWT onto the `Session` that `/api/auth/session` returns. `refreshToken` stays in the
encrypted, httpOnly Auth.js cookie, which only the Next.js server can decrypt.

Nothing is written to `localStorage`, `sessionStorage`, or a JavaScript-readable cookie. In
the browser the access token exists only as React state inside `SessionProvider`, read through
`useAccessTokenProvider()`.

## Why

**The browser genuinely needs the access token.** `libs/garage/realtime-client` (Task 21) opens a
Socket.io connection from the browser and puts the token in the handshake; the API validates
it with the same JWKS logic as the REST guard (Task 11, Task 15). There is no arrangement in
which that token stays server-side. So the honest question is not "does it cross?" but "what
crosses, and for how long?".

**The refresh token is a different class of credential.** It is long-lived and can mint new
access tokens. An access token that leaks is bounded by its expiry — an hour at Okta's
defaults, less here because of rotation. A refresh token that leaks is a standing grant.
Copying it onto the session for symmetry's sake would be a real downgrade for no gain: no
browser code has any use for it, because the renewal happens in the `jwt` callback on the
server.

**`localStorage` would outlive both the session and the tab.** The spec is explicit about
this, and the reasoning holds independently: anything in `localStorage` survives sign-out,
survives the cookie expiring, and is readable by every script on the origin forever. React
state is discarded when the tab closes and is not addressable from another script's point of
view any more than any other closure is. The XSS argument does not distinguish them much —
a script that can run can also just call `/api/auth/session` — but persistence does.

**The provider is a function for the same reason.** `useAccessTokenProvider()` returns a
stable function that reads the *current* session through a ref, so a Socket.io connection or
an API client built once is not rebuilt on every refresh, and never pins a token that has
since been renewed.

## How

`projectSession` in `libs/garage/auth/src/lib/config.ts` rebuilds `accessToken`/`error` from the
token rather than merging over whatever the incoming session held — which is also what
guarantees a stale token cannot survive a failed refresh (`doc/decision/0044-*`).

Secrets stay server-side by construction: `AUTH_SECRET` and `AUTH_OKTA_CLIENT_SECRET` are
passed to `createAuth` as arguments, are validated in `apps/garage/web/src/env.ts`, and carry no
`NEXT_PUBLIC_` prefix — the only thing that puts a value in a Next.js client bundle.

Verified three ways:

1. `config.spec.ts` serialises a projected session built from a JWT carrying a refresh token
   and asserts the token's value does not appear anywhere in the JSON.
2. `client.spec.tsx` renders the **real** `SessionProvider` with a token in the session,
   spies on `Storage.prototype.setItem`, exercises the provider, and asserts the spy was
   never called, both stores are empty, and `document.cookie` does not contain the token.
3. `grep -rl localStorage node_modules/next-auth/` returns nothing — Auth.js's own client
   does not use it either. (It syncs tabs through `BroadcastChannel`.)

`client.spec.tsx` additionally reads the lib's own source files, strips comments, and asserts
neither storage API is named — so the ban also covers code paths the runtime test did not
walk.

## Risk if this is wrong

An XSS on the app's origin can read the access token out of memory or fetch it from
`/api/auth/session`; this decision does not claim otherwise, and no client-side arrangement
would. What it does buy is that the leak is bounded by the access token's lifetime rather
than by the refresh token's, and that closing the tab ends it.

The other risk is drift: a later task adding a "remember this" convenience to
`localStorage` would be caught by the source-text assertion only for the four files it lists.
That list is in `client.spec.tsx` and has to grow with the lib.
