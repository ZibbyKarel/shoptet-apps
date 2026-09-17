# 0256 – The day overview is refetched every time the socket comes back

## What

`useLotRealtime` (`apps/garage/web/src/lot/lot-screen/use-lot-realtime.ts`) watches
`useRealtime().status` and invalidates the `overview.day` query on every
transition **into** `connected`. The transition is derived locally with a ref;
`libs/garage/realtime-client` is unchanged.

## Why

- **A broadcast missed while the socket is down is gone, and nothing noticed.**
  The four handlers patch the cache from `reservation:created` / `cancelled` /
  `reassigned` and `waitlist:updated`. Nothing queues them for a client that was
  not connected. Meanwhile `libs/query` sets `refetchOnWindowFocus: false` and a
  30 s `staleTime`, and TanStack's `refetchOnReconnect` keys off
  `navigator.onLine` — which says nothing about a socket dropped by an API
  restart, a proxy idle timeout or a laptop resume. The grid therefore kept
  drawing spots as free that had been taken during the gap, until the user
  changed the date or wrote something themselves.
- **The asymmetry made it look like an oversight, and it was.**
  `use-cell-locks.ts` already handles exactly this event for locks — it empties
  the map on a drop, because "unknown" must not be drawn as "nobody is editing"
  — and `use-cell-locks.spec.tsx` pins it. `useLotRealtime` had no counterpart,
  and none of its fifteen tests covered a reconnect.
- **Invalidate, do not fetch.** The hook does not own the query; the screen
  does. Marking the entry stale lets whatever is mounted refetch under its own
  key, and keeps this hook's only cache verb the same one the four handlers
  already use.
- **An edge, not a level.** `useRealtime()` exposes the current status only. A
  level check would invalidate on every render while connected. The cross-shard
  note suggested adding `lastConnectedAt` or an `onReconnect` callback to
  `RealtimeProvider`; that file belongs to another shard, and a consumer can
  derive the edge with a ref, so the ref is what this does.
- **The ref starts disarmed, and that is the difference between one refetch and
  two on a page load.** A hook mounting under an already-connected socket
  (navigating from `/settings` back to `/`) has missed nothing and refetches
  nothing. A hook mounting on a cold page starts at `disconnected` —
  `RealtimeProvider`'s initial status — so the first `connected` does fire. That
  is deliberate: the window between the overview being fetched and the handshake
  finishing is a real gap, the same gap as any later one.
- **`rejected` arms it too.** It is a different thing to *tell the user* — it
  has a reconnect button — but the same thing for the cache.

## How

`useReconnectReconciliation(queryKey)`, a private hook at the foot of
`use-lot-realtime.ts`. `apps/garage/web/src/lot/lot-screen/use-lot-realtime.spec.tsx` gains a
controllable `useRealtime` double and eight tests: reconnect after a drop,
recovery from `rejected`, once per reconnect rather than once per render, twice
for two drops, the cold-page-load case, the already-connected mount, the day
that is on screen *now* rather than the one that was, and no invalidation at all
while there is no day. Every count is taken against the contract-derived key, so
an invalidation under some other key fails rather than passes.

## Risk

- **One extra `overview.day` request per cold page load.** Measured against the
  alternative — a client that silently shows a taken spot as free — this is the
  cheap direction. It is deduped against the mount fetch when the two overlap.
- **A flapping connection refetches per flap.** Socket.io's own backoff bounds
  how often that can happen, and the request is a single indexed read.
