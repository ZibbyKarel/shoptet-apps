# 0188 – A realtime scenario waits for the day room before it acts

## What

Before `cell-lock.spec.ts` takes a hold on one page, it waits for the *other*
page to have joined the day room:

```ts
await waitForDayRoom(userTwoPage, DATE);
await openSpot(userPage, SPOT);
await expect(observed).toContainText('právě upravuje');
```

`waitForDayRoom` (`apps/garage/web-e2e/src/support/realtime.ts`) watches the page's own
network traffic for a `day:subscribe` naming that date — on the HTTP polling
request before socket.io upgrades, and on the WebSocket frame after. The
recorder is attached by the persona fixture when the page is created, so it
cannot miss the first emit.

## Why

**A broadcast that nobody is listening for is not sent again.** The gateway
emits `cell:locked` to the room for `date` at the instant the hold is taken; a
socket that joins a moment later is never told. The contract has no procedure
for asking what is currently locked — `useCellLocks` says so itself, and calls
the gap "briefly blind … the safe direction". The only thing that refills a late
joiner's map is the holder's renewal heartbeat at half the TTL, up to fifteen
seconds away.

So a two-page realtime test has a precondition that a two-page HTTP test does
not: **the listener has to be listening before the act**. Without it the test is
asking about an event that may have been addressed to an empty room, and its
failure would read as "the lock does not work".

**What this did not fix, stated plainly.** It was written to explain a
25%-failure flake in this spec and it did not: with the wait in place the suite
still failed 2 runs in 20. The blame then moved to `StrictMode` giving each page
a second socket.io connection, and **that was wrong too** — the suite serves the
built app, where `StrictMode` does not double-invoke effects.

The cause was the spec colliding with itself: two tests sharing one bay as one
persona under `fullyParallel: true`, against a `LockService.release` keyed by
user, so one test's `closeDialog` dropped the other's hold. Fixed by giving each
test its own bay (`cell-lock.spec.ts`, `doc/decision/0187-*`). The `StrictMode`
correction was itself corrected once more in `doc/decision/0221-*`: there was no
second connection to blame in the built app either. The release keyed by user is
narrowed in `doc/decision/0220-*` — a superseded connection can no longer drop
the hold, though the newer one still can.

This wait is kept anyway, for two reasons that stand on their own: the race it
closes is real regardless of which server is running, and a socket that never
connects now fails with a sentence naming the date it never subscribed to,
instead of a tile that quietly stayed grey for five seconds.

### Why it reads the wire rather than the page

- `day:subscribe` has **no acknowledgement** — the gateway's handler returns
  `void`, so there is nothing to await.
- The connection status is not rendered anywhere a locator can reach:
  `lot-header.tsx` surfaces only the terminal `rejected` state.
- Adding either — an ack, or a `data-` attribute for the connection state —
  would be shaping the application around its tests. The emit is already
  observable from outside; nothing needs to change for a test to see it.

### Why not retry the scenario instead

`expect(...).toPass()` around "open the dialog, check the other tile" would have
gone green too, and would have been a retry wearing a precondition's clothes: it
hides a genuinely broken broadcast behind a second attempt, and it leaves a
dialog open between attempts. A precondition is established once, and the
assertion after it runs exactly once.

## How

- `apps/garage/web-e2e/src/support/realtime.ts` — `recordDayRoomSubscriptions`,
  `subscribedDates`, `waitForDayRoom`, and the `E2E_TRACE_REALTIME` switch that
  found the real bug.
- `apps/garage/web-e2e/src/support/fixtures.ts` — the recorder is attached in
  `pageFor`, before the page navigates.
- `apps/garage/web-e2e/src/cell-lock.spec.ts` — both tests.

The payload is matched as text rather than parsed: engine.io frames a polling
request as one or more `\x1e`-separated packets with a type digit in front, and
a second implementation of that framing is a second thing to keep correct. What
this needs is one field.

## Risk

- **It watches an emit, not a delivery.** Strictly, the page having *sent*
  `day:subscribe` does not prove the gateway has *processed* it, and the two
  sockets involved have no ordering between them. The remaining window is the
  server's handling of one packet, against the time it takes the other page to
  click a tile and render a dialog — microseconds against tens of milliseconds.
  There is no stronger signal available without changing the contract.
- **It depends on the packet being readable.** If socket.io ever enabled
  per-message compression, the WebSocket branch would stop matching and the wait
  would time out after thirty seconds with a clear message rather than fail
  silently. engine.io v4 ships with `perMessageDeflate` off.
- **The tracing switch prints traffic.** Only packets whose payload matches
  `"day:*"` or `"cell:*"`, which is a safety property and not a convenience: the
  socket.io CONNECT packet carries the access token in its `auth` payload and
  matches neither, so no credential can reach the log.
