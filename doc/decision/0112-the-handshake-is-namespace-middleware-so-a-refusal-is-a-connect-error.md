# 0112 – The handshake is authenticated in namespace middleware, so a refusal is a CONNECT_ERROR

**Date:** 2026-09-03 · **Status:** accepted · **Task:** 15 (the Socket.io gateway)

## What

`RealtimeGateway.afterInit` installs `server.use((socket, next) => …)`. The token is read from
`socket.handshake.auth.token`, verified through the process's single `JwksVerifierService`, and
resolved to a user through the same `AuthUserService` an HTTP request goes through. A failure
calls `next(new Error('Unauthorized'))`.

The alternative — accept the connection, check the token in `handleConnection`, and
`socket.disconnect()` — is **not** equivalent, and the client is built around the difference.

## Why it has to be middleware

Read from the installed sources rather than inferred:

- `socket.io/dist/namespace.js`, `_add` → `run(socket, err => …)`: a middleware that calls
  `next(err)` reaches `socket._error({ message: err.message, data: err.data })`, and
  `socket.js:574` packets that as `PacketType.CONNECT_ERROR`.
- On the client, `Socket.onpacket`'s CONNECT_ERROR branch calls `destroy()` **before** emitting
  `connect_error`. `destroy()` clears `this.subs`, and `active` is `!!this.subs` — so the
  socket is left inactive and socket.io's own reconnection loop will never touch it again.

`libs/garage/realtime-client` branches on exactly that field (`doc/decision/0061-*`). A refusal
becomes the user-visible `rejected` status, recovered by building a **new** socket — which
re-runs the `auth` callback and therefore presents whatever token the provider has now — three
times, at 1 s / 5 s / 30 s, and then stops.

A disconnect after a *successful* connect produces none of that. `socket.active` stays `true`,
the client reports `connecting`, and socket.io retries forever with a credential the gateway has
already refused: the grid silently stops updating, `useCellLock` never leaves `requesting`, and
only a page reload fixes it. The two shapes are indistinguishable in a unit test of the gateway
and completely different in a browser.

`realtime-handshake.spec.ts` asserts the packet type over a real WebSocket, identified by
`socket.io-parser`'s own `PacketType.CONNECT_ERROR` rather than by a number the spec believes
in.

## Why the token is only ever `handshake.auth.token`

`doc/decision/0060-*` argued the client half. The server half is the part that makes it true:
a gateway that *also* accepted a query-string token would leave the client's careful `auth`
callback pointless and nothing else in the suite would notice. So there are two negative tests
— a valid token in the **query string**, and a valid token under an **`authorization` key** of
the auth object — and both are refused.

`handshakeAuthSchema` is a `looseObject`, not a `strictObject`: `handshake.auth` is also where
socket.io's own connection-state-recovery puts `pid` and `offset`, so extra keys are the
library working rather than a client disagreeing.

The handshake credential is deliberately **not** in `@garage/contract/realtime`, and that is
not a contract-first exception: the contract's realtime entry point declares *events and their
payloads*, and this is a connection-level auth object that exists before any event does.
`libs/garage/realtime-client` makes the same call with its local `RealtimeHandshakeAuth`.

## What a refusal says, and to whom

**To the client: one opaque string.** `{ message: 'Unauthorized' }`, identical for a missing
token, a malformed one, a bad signature, a wrong audience, an expired token and a deactivated
account. `err.data` is never set — whatever goes in it is sent to a caller who has just failed
to authenticate. Two tests pin this: the payloads for a garbage token and for a deactivated
user are asserted to be *equal*, and the wire is asserted to contain neither the token nor a
stack frame.

**To the log: a reason, and never the credential.** The levels mirror
`ContractExceptionFilter`'s, because the situations are the same ones:

| case | level | `err`? |
| --- | --- | --- |
| no token, or a token this API was never going to accept | `debug` | **no** |
| `DomainError` (a deactivated user) | `warn` | yes — the stack names the rule |
| anything else | `error` | yes |

The `debug`-without-`err` row is the load-bearing one. A refused handshake is *retried* by the
client at 1 s / 5 s / 30 s, so a `warn` per refusal from an anonymous caller is a log-flood
vector — the same call the filter makes for a pre-routing client error. And the error's
*message* is not logged either, because the claims parse can raise a `ZodError` that carries
input.

`JwksVerifierService` has already classified and rate-limited its own diagnosis of *why* a
token failed (`doc/decision/0042-*`, `0043-*`), so the operator loses nothing.

## How the no-leak claim is exercised

`realtime-logging.spec.ts` boots the assembled application at **`LOG_LEVEL: 'debug'`** with the
real `buildLoggerOptions` output pointed at an in-memory stream, and reads the bytes pino
emitted. It asserts a line *was* emitted first — without that control, a regression that
silenced logging entirely would pass every other assertion — and then that neither the whole
token nor **any of its three dot-separated parts** appears in any line.

Its own file, not a second `describe`: `LOG_LEVEL` must be set before `AppModule` is imported,
and Jest gives each *file* a fresh module registry. `jest.resetModules()` inside one file
re-evaluates `AppModule` while the harness still holds the previous `PrismaService` class, so
`.overrideProvider(PrismaService)` silently matches nothing and the app opens a real database
connection. That was observed, not feared.

This matters because every other spec in this workspace pins `LOG_LEVEL: 'fatal'`, which is
exactly how a bearer credential reached the logs in four places on a sibling task and survived
review.

## Risk if this is wrong

**`server.use` runs for every namespace this gateway serves.** There is one (`/`). A second
namespace added later gets no authentication unless its own middleware is installed —
`@WebSocketGateway('/admin')` would be a silent hole. There is no test for a namespace that
does not exist; the guard is that adding one means adding a gateway, and this file is where a
reviewer would look.

**The rejection message is a string, not a code.** A client cannot distinguish "your token
expired, refresh and retry" from "your account is deactivated, stop trying" — so
`libs/garage/realtime-client` retries all of them three times. That is the deliberate trade
(`doc/decision/0061-*`): an oracle for an unauthenticated caller is worth more to an attacker
than three wasted handshakes are to a deactivated employee.
