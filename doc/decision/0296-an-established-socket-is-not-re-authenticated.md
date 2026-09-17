# 0296 – An established socket is not re-authenticated mid-connection

**Date:** 2026-09-03 · **Status:** accepted · **Task:** final-review fix round (libs-wrappers,
M-6) · **Follows on from:** `doc/decision/0060-*`, `doc/decision/0061-*`

## What

The access token is checked **once per connection**, at the handshake. Nothing revalidates a
socket that stays connected. A session revoked, or a token expired, mid-connection keeps
receiving room broadcasts until the transport drops.

This is a decision, not an oversight, and it is recorded rather than fixed.

## What *is* handled, and is easy to mistake for this

`socket.ts` passes `auth` as a **function**, not an object, so Socket.io re-reads it on every
engine open — the first connect and every reconnect alike. A socket therefore never re-presents a
stale token *across* a reconnect; it presents whatever `libs/garage/auth`'s provider has at that moment.
A refused handshake is terminal and recovered by building a **new** socket
(`doc/decision/0061-*`), which re-runs the same callback.

So the gap is narrow and specific: the window between "this token stopped being valid" and "this
transport happens to drop".

## Why not build token re-validation now

- **The exposure is a room broadcast, and nothing else.** The four server → client events carry a
  day's reservations, a cell hold and its holder's `userSummary` — three fields, already visible
  to everyone in the room, and already scoped to a day the socket joined while it *was*
  authorised. Every action a socket can take is separately authorised on the API side, where the
  token is checked per request; the cell lock is explicitly a courtesy and not an authorisation
  step (`libs/garage/contract/src/realtime/commands.ts`).
- **The window is short in practice.** Single-instance deployment, a 30 s lock TTL, and Socket.io
  ping/pong that drops an idle transport. A revoked session survives until the next transport
  event, not indefinitely.
- **Every implementation has a cost that exceeds it.** A periodic re-check would need a
  contract-first command and an ack (nothing exists), and a server-side timer per socket — the
  sweep `doc/decision/0111-*` rejected on the lock path for the same reason. Disconnecting on
  token expiry would drop live sockets on ordinary rotation, which is a worse user-visible defect
  than the one being fixed. Either is a real feature with a real test surface, and this is a
  last-gate fix round.

If the deployment ever stops being single-instance, or the broadcast payloads ever carry something
not already public to the room, this should be revisited — and revisited as a gateway change, not
a client one: `libs/garage/realtime-client` cannot enforce it, because the client is the party whose
token is in question.

## Where it is written down

`libs/garage/realtime-client/src/lib/socket.ts`, in the "Why `auth` is a function" section — the exact
place a reader forms the belief that the token is kept fresh, which was the finding: the file said
a true thing about reconnects in a way that read as a claim about the whole connection.
