'use client';

/**
 * Who else is editing which cell of the day currently on screen.
 *
 * **Why this is not query data, unlike everything else on the screen.** The
 * contract exposes no way to *ask* for the current locks: `overview.day`
 * carries spots, reservations, queue counts and the window, and nothing about
 * holds. A cell lock exists only as a broadcast (`cell:locked` /
 * `cell:unlocked`), lives for about thirty seconds, and is deliberately
 * ephemeral. Storing it in the query cache would mean minting a query key no
 * procedure backs, which is exactly the contract-first rule this project is
 * built on. So it is component state — the one piece of realtime state on this
 * screen that is not a cache patch, and it is that way because the contract
 * says so rather than for convenience.
 *
 * `useCellLock` in `libs/garage/realtime-client` is the *other* half and is not this:
 * it takes and renews **this** client's own hold on one cell. This hook
 * listens for everybody else's, across the whole day.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRealtime, useRealtimeEvent } from '@garage/realtime-client';
import type { DateOnly } from '@garage/i18n';
import type { CellLockView } from '../lot-view';

export type CellLockMap = ReadonlyMap<string, CellLockView>;

const EMPTY: CellLockMap = new Map();

/**
 * Drops every hold whose TTL has run out.
 *
 * The contract requires this rather than merely permitting it —
 * `cellLockedEventSchema`: "`expiresAt` travels with the event so a client can
 * clear the state on its own when the TTL runs out. A lost `cell:unlocked` (a
 * browser closed mid-edit, a dropped socket) must not freeze a tile forever."
 * So this is the client honouring the field the event carries, not a UI-side
 * workaround for a server that might not broadcast.
 *
 * Returns the same reference when nothing expired, so a sweep that finds
 * nothing costs no render.
 */
export function pruneExpiredLocks(locks: CellLockMap, now: number): CellLockMap {
  let expired = false;
  for (const lock of locks.values()) {
    // An unparseable timestamp is `NaN`, and every comparison with `NaN` is
    // false — so a malformed expiry keeps the lock rather than dropping it on
    // the next tick. The payload has already been through
    // `cellLockedEventSchema`, so this is defence in depth.
    if (Date.parse(lock.expiresAt) <= now) {
      expired = true;
      break;
    }
  }
  if (!expired) return locks;

  const next = new Map<string, CellLockView>();
  for (const [spotId, lock] of locks) {
    if (!(Date.parse(lock.expiresAt) <= now)) next.set(spotId, lock);
  }
  return next;
}

/**
 * When the next hold lapses, or `null` if none will.
 *
 * The sweep is scheduled to this instant rather than run on an interval: a
 * one-second poll would wake the tab forever for a state that is empty almost
 * all the time, and a lock's own expiry is the only moment anything can
 * change without an event arriving.
 */
export function nextLockExpiryAt(locks: CellLockMap): number | null {
  let soonest: number | null = null;
  for (const lock of locks.values()) {
    const at = Date.parse(lock.expiresAt);
    if (!Number.isFinite(at)) continue;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}

/**
 * Every other user's editing hold on `date`, keyed by `parkingSpotId`.
 *
 * Three things reset it, and all three are the honest answer rather than a
 * stale one:
 *
 * - **the day changing** — the holds belong to the day that was on screen;
 * - **the connection dropping** — while the socket is down no `cell:unlocked`
 *   can arrive, so continuing to hatch a tile would assert something this
 *   client has no way to know is still true;
 * - **a hold expiring** — see {@link pruneExpiredLocks}.
 *
 * After a reconnect the map starts empty and refills from the renewal
 * heartbeat every holder is sending (`cell:lock` re-sent at half the TTL,
 * `doc/decision/0062-*`), *provided the gateway re-broadcasts a renewal*.
 * Whether it does is Task 15's to settle; if it does not, a hold taken before
 * the drop stays invisible until it is next renewed or released. Being briefly
 * blind is the safe direction — the lock is a courtesy, and the API re-checks
 * everything on `reservation.create` regardless.
 */
export function useCellLocks(date: DateOnly | null): CellLockMap {
  const { status } = useRealtime();
  const [locks, setLocks] = useState<CellLockMap>(EMPTY);

  useRealtimeEvent(
    'cell:locked',
    useCallback(
      (event) => {
        if (event.date !== date) return;
        setLocks((current) => {
          const next = new Map(current);
          next.set(event.parkingSpotId, {
            holderId: event.lockedBy.id,
            holderName: event.lockedBy.name,
            expiresAt: event.expiresAt,
          });
          return next;
        });
      },
      [date]
    )
  );

  useRealtimeEvent(
    'cell:unlocked',
    useCallback(
      (event) => {
        if (event.date !== date) return;
        setLocks((current) => {
          if (!current.has(event.parkingSpotId)) return current;
          const next = new Map(current);
          next.delete(event.parkingSpotId);
          return next;
        });
      },
      [date]
    )
  );

  // The day changed, or the socket went away. Either way what is held now is
  // unknown, and unknown is drawn as "nobody is editing" rather than as
  // whatever was true a moment ago.
  const connected = status === 'connected';
  useEffect(() => {
    setLocks(EMPTY);
  }, [date, connected]);

  const soonest = nextLockExpiryAt(locks);
  useEffect(() => {
    if (soonest === null) return;

    let timer: ReturnType<typeof setTimeout>;

    // Reschedules itself from *inside* the callback, rather than depending on
    // `locks` changing identity to make this effect (keyed on `soonest`)
    // re-run. That distinction matters for a case `jest.advanceTimersByTime`
    // cannot produce but a real clock can: a coarse timer, or a clock nudged
    // backwards, firing this callback a moment before `Date.now()` actually
    // reaches `target`. `pruneExpiredLocks` then legitimately returns the
    // same reference (deliberately — see its own docs), `setLocks` bails out,
    // `locks` never changes, and an effect keyed only on `soonest` would never
    // fire again — leaving that hold hatched past its `expiresAt` until an
    // unrelated event happens to touch the map. Recomputing the next expiry
    // and rescheduling unconditionally, every time the timer fires, closes
    // that hole: an early wakeup just books a very short follow-up timer
    // instead of losing the sweep entirely.
    function fire(target: number) {
      const delay = Math.max(target - Date.now(), 0);
      timer = setTimeout(() => {
        setLocks((current) => {
          const pruned = pruneExpiredLocks(current, Date.now());
          const next = nextLockExpiryAt(pruned);
          if (next !== null) fire(next);
          return pruned;
        });
      }, delay);
    }

    // Clamped at zero inside `fire`: an expiry already in the past must fire
    // on the next tick, not be scheduled with a negative delay (which
    // `setTimeout` treats as zero anyway, but relying on that is a
    // coincidence rather than a decision).
    fire(soonest);
    return () => {
      clearTimeout(timer);
    };
  }, [soonest]);

  // `locks` is already the stable reference `useState` hands back across
  // renders where nothing changed (every setter above and `pruneExpiredLocks`
  // preserve identity on a no-op update) — a `useMemo` keyed on the same value
  // neither stabilises anything further nor computes anything.
  return locks;
}
