# 0060 – The websocket token is a handshake callback, not a query string

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 21 (`libs/garage/realtime-client`)

## What

`createRealtimeSocket` passes the access token to Socket.io as the **function** form of the
`auth` option:

```ts
io(url, {
  path,
  auth: (cb) => {
    void Promise.resolve(getAccessToken()).then(
      (token) => cb(toHandshakeAuth(token)),
      () => cb({})
    );
  },
});
```

It reaches the gateway as `socket.handshake.auth.token`. Two things are deliberately absent
from the options object, and a test asserts both: **`query`** and **`extraHeaders`**.

Three consequences follow from the function form specifically:

- the provider is re-read on **every** engine open — the first connect and every reconnect;
- the CONNECT packet is not sent until the callback fires, so an `async` provider (which
  `libs/garage/auth`'s is, once a refresh is in flight) is awaited rather than raced;
- a provider that rejects, or that has no session, produces `{}` — an empty handshake the
  gateway refuses — rather than a connection that quietly proceeds unauthenticated.

## Why

**A query string is written to access logs verbatim.** Nginx's `$request_uri`, an ELB access
log, a CDN log, `engine.io`'s own debug output — none of them redact. `?token=eyJ…` therefore
turns a credential with a lifetime of minutes into one with the retention period of a log
bucket, readable by anybody with log access, which is a strictly larger set than the people
who may act as that user. The handshake payload travels in the websocket upgrade (or, on the
polling transport, in a POST body), and neither is logged by default. `plan.md` calls this out
explicitly; it is also the standard Socket.io guidance.

**`extraHeaders` would not have worked anyway.** The browser `WebSocket` API cannot set
request headers, so Socket.io only applies `extraHeaders` to the polling transport — a socket
that upgraded to websocket would silently stop presenting its credential. An `Authorization`
header is the right answer for HTTP (`libs/shared/api-client`) and simply is not available here.

**An object would pin the token.** `auth` as a plain object is read once, when the socket is
constructed. This socket is meant to live as long as the tab, across a token expiry, a refresh
and any number of transport drops. `libs/garage/auth` rotates the access token in the `jwt` callback
and the browser polls `/api/auth/session` every five minutes (`doc/decision/0049-*`), so the
token the socket was built with is *expected* to go stale. Re-reading a provider is the same
per-request seam `libs/shared/api-client` already uses for its `Authorization` header — which is why
`AccessTokenProvider` has one definition, in `libs/shared/api-client`, that both consume.

**Failing to a `{}` handshake is not a downgrade path.** The gateway (Task 15) requires a
valid token; an empty `auth` is refused exactly as a forged one is. The alternative —
throwing inside the callback — leaves the socket in a state where it has neither connected nor
reported anything, and swallowing the error into a *successful* anonymous connect would be the
silent downgrade. The rejection reason is deliberately not logged: it can carry the token that
failed to refresh (`doc/decision/0048-*`).

## How it is verified

`libs/garage/realtime-client/src/lib/socket.spec.ts` asserts on packets a **real**
`socket.io-client` socket produced — the fixture replaces only the transport, never the
protocol (`src/__fixtures__/offline-transport.ts`).

| test | claim |
| --- | --- |
| "travels in the handshake auth payload, not the URL" | the CONNECT packet carries `{ token }` |
| "is re-read from the provider on every reconnect" | after a drop and a re-open, the second CONNECT carries the **new** token |
| "awaits an asynchronous provider before connecting" | nothing is sent while the token is pending |
| "sends an empty handshake when there is no session" | `{}`, not `{ token: undefined }` |
| "sends an empty handshake when the provider fails" | `{}`, and the rejection reason does not travel |
| "dials the configured path without putting anything in the query string" | `opts.query` and `opts.extraHeaders` are undefined; the URI has no `?` |

The reconnect test was mutation-checked: replacing the callback with a token read once at
construction makes it fail with `"token": "jwt-first"` where `"jwt-second"` was expected.

## Risk

**The token is only as fresh as the last render.** `useAccessTokenProvider` reads the session
through a ref written during render, so a reconnect that happens between a token rotation and
the next commit presents the previous token. Auth.js's five-minute poll against a token
lifetime measured in tens of minutes makes the window small.

That it is "a retry, not a lockout" is **not** free, and the first version of this record
assumed it wrongly: `socket.io-client` destroys a socket whose handshake was refused, so
nothing re-reads the provider by itself. `doc/decision/0061-*` is what makes the sentence true
— `useRealtimeConnection` builds a **new** socket, which runs this callback again.

**A `cb` that is never called hangs the socket open.** Socket.io does not time the `auth`
callback out; if a provider neither resolved nor rejected, the CONNECT packet would never be
sent and the connection would sit in `connecting` forever. Every provider in this workspace is
either synchronous or a settled promise, and `libs/garage/auth`'s refresher has its own error path,
so this is a contract on the provider rather than a live hazard — but it is the reason the
rejection branch exists at all instead of leaving the promise unhandled.

**Nothing here has been exercised against a real gateway.** Task 15 builds it. This decision
fixes *where the client puts the token*; that the server reads it from `handshake.auth.token`
is Task 15's obligation, and the e2e proof belongs to Task 7 of Fáze 7.
