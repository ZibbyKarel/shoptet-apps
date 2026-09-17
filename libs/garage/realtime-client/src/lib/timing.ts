/**
 * When the cell-lock hook next has to do something, in milliseconds from now.
 *
 * Two delays, both derived from a `expiresAt` the gateway sent, both built on
 * one rule: an expiry that is already past, or a string `Date.parse` cannot
 * read, comes out as the floor and never as `NaN`. `setTimeout(NaN)` fires
 * immediately, so a `NaN` here is a busy loop against the gateway rather than
 * a visible failure — which is why the rule is written once, in
 * {@link delayUntil}, instead of twice in two functions that differ by a
 * multiplication.
 *
 * Its own module because it is pure: `timing.spec.ts` drives it with no
 * socket, no provider and no React. That used to be the reason these were
 * exported from `@garage/realtime-client` itself, where no consumer named
 * them — an internal seam pushed out to the external one to make it reachable.
 * This is the seam it wanted.
 */

/**
 * Fraction of the remaining TTL after which the hold is renewed.
 *
 * Half, so a renewal that is lost in flight still leaves a second attempt
 * inside the same TTL — `CELL_LOCK_ACK_TIMEOUT_MS` and
 * `CELL_LOCK_ACK_ATTEMPTS` in `./cell-lock` are what make that second attempt
 * exist.
 * Derived from the server's `expiresAt` rather than from a TTL constant copied
 * onto the client: the client is then correct for whatever TTL the gateway is
 * configured with, and there is no second number to keep in sync across two
 * tasks.
 */
export const CELL_LOCK_RENEW_FRACTION = 0.5;

/**
 * Floor on the renewal delay.
 *
 * Without it, an `expiresAt` that is already in the past — a clock skew, a
 * slow round trip — schedules a zero-delay timer that re-requests the lock as
 * fast as the event loop allows. A one-second floor turns the worst case into
 * one request per second instead of a busy loop against the gateway.
 */
export const MIN_CELL_LOCK_RENEW_DELAY_MS = 1_000;

/**
 * The remaining time until `expiresAt`, optionally scaled, floored at
 * {@link MIN_CELL_LOCK_RENEW_DELAY_MS}.
 *
 * `Date.parse('soon')` is `NaN` and every comparison with `NaN` is false, so
 * `Math.max` alone would let it through — the unparseable case has to be
 * caught explicitly.
 */
function delayUntil(expiresAt: string, now: number, fraction = 1): number {
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining)) return MIN_CELL_LOCK_RENEW_DELAY_MS;
  return Math.max(remaining * fraction, MIN_CELL_LOCK_RENEW_DELAY_MS);
}

/**
 * How long to wait before renewing a hold that expires at `expiresAt`.
 *
 * Pure and exported so it can be tested on its own: the interesting cases are
 * an expiry already in the past and an unparseable one, both of which have to
 * come out as the floor rather than as `NaN` — `setTimeout(NaN)` fires
 * immediately, which is the busy loop {@link MIN_CELL_LOCK_RENEW_DELAY_MS}
 * exists to prevent.
 */
export function renewDelayMs(expiresAt: string, now: number): number {
  return delayUntil(expiresAt, now, CELL_LOCK_RENEW_FRACTION);
}

/**
 * How long to wait before asking again for a cell somebody else holds until
 * `expiresAt`.
 *
 * The **whole** remaining time, not half of it: this is not a heartbeat on a
 * hold this client owns, it is a wait for somebody else's to lapse, and asking
 * before it has is the polling `useCellLock` (`./cell-lock.ts`) deliberately
 * does not do.
 *
 * It is the *backstop*, not the mechanism — the gateway broadcasts
 * `cell:unlocked` on all four ways a hold ends (`doc/decision/0111-*`), and
 * that arrives first in every ordinary case. This timer is what makes the two
 * independent, so a broadcast that is never sent or never arrives cannot leave
 * a form asserting "právě upravuje …" forever.
 *
 * Floored at {@link MIN_CELL_LOCK_RENEW_DELAY_MS} for the same reason the
 * renewal is, and the reason is sharper here: an `expiresAt` already in the
 * past would schedule a zero-delay timer whose request is answered
 * `HELD_BY_OTHER` with the same stale `expiresAt`, which schedules another —
 * a busy loop against the gateway that no other path in this hook can produce.
 * `Date.parse('soon')` is `NaN`, and every comparison with `NaN` is false, so
 * the unparseable case has to be caught explicitly rather than by `Math.max`.
 */
export function contendedRetryDelayMs(expiresAt: string, now: number): number {
  return delayUntil(expiresAt, now);
}
