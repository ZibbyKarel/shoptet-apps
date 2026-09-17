/**
 * The editing hold on one cell of the day × spot grid.
 *
 * A cell lock is a **courtesy, not an authorization step** (see
 * `libs/garage/contract/src/realtime/commands.ts`): holding it does not book
 * anything, and a client that skips it gets a `CONFLICT` from
 * `reservation.create` instead of a nicer message. What it buys is the "právě
 * upravuje …" state on everybody else's tile while one user has a form open.
 *
 * Four things have to be true for that state not to get stuck, and this hook
 * exists to make all four automatic:
 *
 * 1. **The hold has to be renewed.** The server's TTL is short (~30 s) on
 *    purpose — a browser that closes mid-edit must not freeze a tile — so a
 *    form that stays open longer than that has to say so. There is no separate
 *    heartbeat command: re-sending `cell:lock` for a cell you already hold
 *    extends it, which is the whole heartbeat. See {@link renewDelayMs} for
 *    when — and {@link CELL_LOCK_ACK_TIMEOUT_MS} for why a renewal whose
 *    acknowledgement never comes back does not end the heartbeat.
 * 2. **The hold has to be given back.** On unmount, on `enabled` going false,
 *    and on the cell changing — every one of them is the same effect cleanup,
 *    so there is no path that closes the form without a `cell:unlock`.
 *
 *    With one measured exception, which is React's rather than this hook's:
 *    when the **whole provider tree** is deleted at once, React runs a
 *    deletion's cleanups parent-first, so `useRealtimeConnection` has already
 *    disconnected the socket by the time this cleanup runs and there is
 *    nothing left to say `cell:unlock` on. That is not a leak — a dropped
 *    socket is exactly how the gateway learns to release a hold, and it is the
 *    same path a closed tab takes — but it does mean the emit is guaranteed
 *    for the case that matters (a form closing on a live page) and redundant
 *    for the case it is not. `cell-lock.spec.tsx` tests the first;
 *    `connection.spec.tsx` asserts the socket really is closed for the second.
 * 3. **The hold has to be re-taken after a reconnect.** A dropped socket drops
 *    the server's lock with it, so the hook re-requests on the new connection
 *    rather than believing the state it had.
 * 4. **A cell somebody else holds has to become askable again.** `held-by-other`
 *    is the one status a form can sit in indefinitely, and it is the one the
 *    hook cannot resolve by itself — the cell becomes free because of something
 *    that happens on *another* client. Two independent things end it, and both
 *    are wired here rather than assumed: the gateway's `cell:unlocked` broadcast
 *    (`doc/decision/0111-*`, which is emitted on all four ways a hold can end),
 *    and the ack's own `expiresAt` running out. Either one alone would do; both
 *    are here because 0111 says in as many words that neither side should
 *    assume the other did it. Neither is polling — see
 *    {@link contendedRetryDelayMs}.
 */

import { useEffect, useRef, useState } from 'react';
import type { CellLockAck, CellLockCommand } from '@garage/contract/realtime';
import { useRealtimeInternals, useRealtimeEvent } from './connection';
import { parseAck } from './validation';
// The two delay functions and the two constants they are built from live in
// `./timing`: they are pure arithmetic over an `expiresAt`, they share one
// invariant (an unparseable or past expiry comes out as the floor, never
// `NaN`), and holding that invariant in one place is why they are not inline
// here. `timing.spec.ts`'s cases are the ones that used to justify exporting
// them all the way out of the lib.
import { contendedRetryDelayMs, renewDelayMs } from './timing';

/**
 * How long to wait for a `cell:lock` acknowledgement before treating it as
 * lost.
 *
 * `socket.emit(…, cb)` has **no** timeout of its own: a callback whose ack
 * never arrives is simply never called. Since the next renewal is scheduled
 * from inside that callback, one dropped ack would end the heartbeat for good
 * and the hold would lapse while the form still said `held`. `socket.timeout()`
 * is the library's own answer — it calls the callback with an error instead of
 * never calling it, which is what turns a lost ack into something this hook can
 * act on.
 *
 * Sized against the shortest TTL the gateway is expected to use (~30 s, so a
 * renewal at ~15 s): {@link CELL_LOCK_ACK_ATTEMPTS} attempts of 5 s resolve
 * within 10 s of the renewal falling due, comfortably inside the same TTL.
 */
export const CELL_LOCK_ACK_TIMEOUT_MS = 5_000;

/**
 * How many times one `cell:lock` is sent before the hook gives up and drops to
 * `idle`.
 *
 * Two: the attempt and one retry. The retry is the "second attempt inside the
 * same TTL" the half-TTL renewal exists to leave room for. It is capped rather
 * than open-ended because a gateway that is answering nothing is not going to
 * start answering because a form kept asking, and an uncapped retry on a
 * contended cell is the traffic the `cell:unlocked` broadcast exists to avoid.
 *
 * Giving up means `idle`, not a frozen `held`: a UI that keeps a form open on a
 * hold the server has already released is the failure this whole hook exists to
 * prevent.
 */
export const CELL_LOCK_ACK_ATTEMPTS = 2;

/** Who is holding a cell somebody else asked for, derived from the ack. */
export type CellLockHolder = Extract<CellLockAck, { result: 'HELD_BY_OTHER' }>['lockedBy'];

/**
 * Where the hold on one cell stands, as a union over `status`.
 *
 * - `idle` — not asked for (disabled, or no connection).
 * - `requesting` — asked, no answer yet.
 * - `held` — this client holds it until `expiresAt`, and is renewing it.
 * - `held-by-other` — `lockedBy` has it until `expiresAt`. **It is not
 *   terminal:** the hook asks again when the gateway broadcasts `cell:unlocked`
 *   for this cell, and again if that `expiresAt` passes without one arriving,
 *   so a consumer rendering "právě upravuje …" off this status will see it
 *   clear.
 *
 * A union rather than a status beside two nullable fields, because the second
 * of those bullets is a *mechanism*, not a description: both of the things that
 * un-stick a `held-by-other` need an `expiresAt` — `contendedRetryDelayMs`
 * takes a non-nullable `string` — so a `held-by-other` carrying `null` could
 * schedule no backstop timer and would freeze a tile on "právě upravuje …" for
 * a user who closed their laptop, which is the exact failure
 * `doc/decision/0111-*` exists to prevent. The flat shape let the compiler sign
 * that off. It also means a consumer reading `lockedBy` gets a holder rather
 * than `CellLockHolder | null` in every status, with a fallback to invent.
 */
export type CellLockState =
  | { readonly status: 'idle' }
  | { readonly status: 'requesting' }
  | { readonly status: 'held'; readonly expiresAt: string }
  | {
      readonly status: 'held-by-other';
      readonly expiresAt: string;
      readonly lockedBy: CellLockHolder;
    };

/** Derived, so the four statuses are stated once. */
export type CellLockStatus = CellLockState['status'];

const IDLE: CellLockState = { status: 'idle' };

export interface UseCellLockOptions extends CellLockCommand {
  /**
   * Ask for the hold. `false` (the default is `true`) releases one already
   * held — this is what a closing form flips.
   */
  readonly enabled?: boolean;
}

/**
 * Takes, renews and releases the editing hold on one cell.
 *
 * The whole lifecycle lives in a single effect, which is what makes the four
 * guarantees above structural rather than remembered: every way of leaving the
 * cell — unmount, `enabled: false`, a different cell, a lost connection — is
 * the same cleanup, and every way of arriving at one — including "the cell this
 * form wants has just been announced free" — is the same setup.
 */
export function useCellLock(options: UseCellLockOptions): CellLockState {
  const { date, parkingSpotId, enabled = true } = options;
  const { socket, status: connectionStatus, reportInvalidPayload } = useRealtimeInternals();
  const [state, setState] = useState<CellLockState>(IDLE);

  // The current state, readable from inside the effect without making the
  // effect depend on it — a dependency would tear the lock down and re-take it
  // on every status change the effect itself caused.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Bumped when the cell this hook wants is announced free while somebody else
  // was holding it. It is an effect dependency, so the bump re-runs the whole
  // setup — which is the same "arrive at a cell" path a reconnect and a changed
  // cell take, rather than a second, parallel way to ask for a hold.
  //
  // The teardown it causes is safe by construction: `held` is false in
  // `held-by-other`, so no `cell:unlock` is emitted for a hold this client
  // never had.
  const [contention, setContention] = useState(0);

  // Not a poll: this fires once per broadcast, and only for this cell, and only
  // out of the one status that cannot resolve itself. A cell that is announced
  // free while this client is `requesting` or already `held` is ignored — the
  // exchange in flight is the newer information.
  useRealtimeEvent('cell:unlocked', (event) => {
    if (event.date !== date || event.parkingSpotId !== parkingSpotId) return;
    if (stateRef.current.status !== 'held-by-other') return;
    setContention((n) => n + 1);
  });

  useEffect(() => {
    if (socket === null || !enabled || connectionStatus !== 'connected') {
      setState(IDLE);
      return;
    }

    const cell: CellLockCommand = { date, parkingSpotId };
    let disposed = false;
    let held = false;
    // At most one timer is ever pending — a renewal while this client holds the
    // cell, a retry while somebody else does — so one handle covers both, and
    // one `clearTimeout` in the cleanup covers both.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (run: () => void, delay: number) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(run, delay);
    };
    // Sends of the *current* `cell:lock` that have gone unanswered. Reset by
    // any answer, so it counts consecutive losses rather than lifetime ones.
    let unanswered = 0;

    const request = () => {
      // `held` is deliberately absent: a renewal must not flicker the form back
      // to `requesting`, because the hold was never lost. `requesting` is
      // absent because re-announcing it would be a re-render that says nothing.
      // `held-by-other` **is** here — the holder and the expiry this hook was
      // showing are now stale, and continuing to name them while asking again
      // is the frozen "právě upravuje …" the whole hook exists to prevent.
      const { status } = stateRef.current;
      if (status === 'idle' || status === 'held-by-other') {
        setState({ status: 'requesting' });
      }

      // `.timeout()` rather than a bare `emit`: without it a lost ack means the
      // callback is never called at all, and since the next renewal is
      // scheduled from inside it, the heartbeat would stop for good — silently,
      // with the form still showing `held`. See CELL_LOCK_ACK_TIMEOUT_MS.
      socket.timeout(CELL_LOCK_ACK_TIMEOUT_MS).emit('cell:lock', cell, (error, raw) => {
        // The effect may have been cleaned up while the ack was in flight —
        // the form closed, the socket dropped. Answering it would resurrect a
        // hold nobody is going to release.
        if (disposed) return;

        if (error) {
          unanswered += 1;
          if (unanswered < CELL_LOCK_ACK_ATTEMPTS) {
            // The retry the half-TTL renewal leaves room for. No extra delay:
            // the ack timeout already spaced it.
            request();
            return;
          }
          // Out of attempts. Drop the claim rather than leave the UI asserting
          // a hold the server has stopped confirming — the timer is not
          // rescheduled, so this is where the heartbeat ends, deliberately.
          // No `cell:unlock` either, for the same reason none is sent on a
          // dropped socket: this client's exchange is not being answered, so
          // the server's TTL is what releases the hold.
          held = false;
          setState(IDLE);
          return;
        }

        unanswered = 0;
        const parsed = parseAck('cell:lock', raw);
        if (!parsed.ok) {
          reportInvalidPayload(parsed.report);
          held = false;
          setState(IDLE);
          return;
        }

        const ack = parsed.data;
        if (ack.result === 'ACQUIRED') {
          held = true;
          setState({ status: 'held', expiresAt: ack.expiresAt });
          schedule(request, renewDelayMs(ack.expiresAt, Date.now()));
          return;
        }

        // Somebody else has it. Still no polling — nothing is sent until one of
        // the two things that can end *their* hold has happened:
        //
        //   - the gateway broadcasts `cell:unlocked`, which bumps `contention`
        //     and re-runs this effect (the ordinary case, and the fast one);
        //   - their `expiresAt` passes with no broadcast having arrived, which
        //     is this timer.
        //
        // The timer is the backstop `doc/decision/0111-*` asks for by name: it
        // is what stops a broadcast that is never sent, or never arrives,
        // freezing this form on a holder who left. See
        // `contendedRetryDelayMs` for why it waits the *whole* remaining TTL.
        held = false;
        setState({ status: 'held-by-other', expiresAt: ack.expiresAt, lockedBy: ack.lockedBy });
        schedule(request, contendedRetryDelayMs(ack.expiresAt, Date.now()));
      });
    };

    request();

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      // Only a hold this client actually has, and only while there is still a
      // socket to say it on: the server releases the lock by itself when the
      // connection drops.
      if (held && socket.connected) socket.emit('cell:unlock', cell);
      setState(IDLE);
    };
  }, [socket, connectionStatus, enabled, date, parkingSpotId, reportInvalidPayload, contention]);

  return state;
}
