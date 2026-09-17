# 0261 – A dropped realtime connection is named; a not-yet-connected one is not

## What

`toRealtimeNoticeView(status, hasEverConnected)` in
`apps/garage/web/src/lot/lot-view.ts` decides which of three things the lot screen
draws above the map: nothing, the quiet notice, or the notice with a
"Připojit znovu" button. `RealtimeNotice` takes `onReconnect` as optional and
omits the button when it is absent.

## Why

- **Only the terminal failure was surfaced.** `lot-screen.tsx` rendered
  `RealtimeNotice` for `realtimeStatus === 'rejected'` and nothing else.
  `RealtimeStatus` also has `connecting` and `disconnected`, and neither was
  drawn anywhere — so the user could not tell "the board is live" from "the
  board stopped updating four minutes ago", which is precisely the state
  `doc/decision/0256-*` describes. `lot-header.tsx` already argues that a
  silently-frozen grid is the failure worth naming; this is the same argument
  one status wider.
- **`hasEverConnected` is the whole subtlety.** `RealtimeProvider` starts at
  `disconnected` and stays there until the handshake finishes — longer still for
  a visitor whose session has not resolved, because `RealtimeBoundary` holds the
  socket closed until then. A rule reading the status alone would flash "Živé
  aktualizace jsou odpojené" on every single page load, which is worse than
  saying nothing: a warning that is usually wrong is a warning nobody reads.
  Before the first `connected` there is no stale data to warn about — the grid
  has not gone stale, it has not arrived.
- **`rejected` is exempt from that rule.** It is terminal by construction
  (`doc/decision/0061-*`), so no later state would correct it, and it is refused
  *credentials* rather than a slow start.
- **No button on the quiet variant.** The connection is already retrying; a
  control that duplicates what is in progress invites a click that changes
  nothing. `reconnect()` exists for the case where nothing else will happen.
- **One string covers both.** `lot.realtimeRejected` is "Živé aktualizace jsou
  odpojené — přehled se nemusí sám obnovovat." The key is named for the state it
  was written for, but the sentence names neither state — it says the connection
  is down and what that means for the screen — so a second, near-identical
  string so that two keys could differ would be catalogue noise.
- **The decision is a pure function in `lot-view.ts`**, which is where this
  screen's decisions live, so it is unit-tested without a DOM and the screen only
  has to draw the answer.

## How

- `apps/garage/web/src/lot/lot-view.ts` — `RealtimeNoticeView` and
  `toRealtimeNoticeView`.
- `apps/garage/web/src/lot/lot-header/lot-header.tsx` — `RealtimeNotice`'s `onReconnect` is
  optional; the button is conditional on it.
- `apps/garage/web/src/lot/lot-screen/lot-screen.tsx` — a `useRef` latched to `true` on the first
  `connected` (written during render: it only ever goes false → true, and it is
  read in the same render that sets it).
- `lot-view.spec.ts` covers the rule; `lot-screen.spec.tsx` covers what is drawn,
  including that the notice does not appear on a cold load and that the
  `rejected` button is wired to the connection's `reconnect`.

## Risk

- **`connecting` is treated as `disconnected` once the board has been live.**
  Socket.io reports transport retries as `connecting`, so the notice persists
  through a reconnection attempt rather than blinking off and on. That is the
  honest reading: during a retry the board is not live.
