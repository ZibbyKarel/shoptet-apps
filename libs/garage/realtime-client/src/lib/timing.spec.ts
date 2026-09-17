/**
 * The two cell-lock delays, driven with no socket, no provider and no React —
 * which is the whole reason `timing.ts` is its own module. Moved here verbatim
 * from `cell-lock.spec.tsx` when it was split out.
 *
 * The interesting cases are not the happy ones: an expiry already in the past
 * and an unparseable one both have to come out as the floor rather than as
 * `NaN`, because `setTimeout(NaN)` fires immediately and turns a lapsed hold
 * into a busy loop against the gateway.
 */

import { MIN_CELL_LOCK_RENEW_DELAY_MS, contendedRetryDelayMs, renewDelayMs } from './timing';

const NOW = Date.parse('2026-09-15T08:00:00.000Z');
const TTL_MS = 30_000;
const EXPIRES_AT = new Date(NOW + TTL_MS).toISOString();

describe('renewDelayMs', () => {
  it('renews halfway through the remaining TTL', () => {
    expect(renewDelayMs(EXPIRES_AT, NOW)).toBe(TTL_MS / 2);
  });

  it('never schedules faster than the floor, even for an expiry in the past', () => {
    expect(renewDelayMs(new Date(NOW - 60_000).toISOString(), NOW)).toBe(
      MIN_CELL_LOCK_RENEW_DELAY_MS
    );
  });

  it('never returns NaN for an unparseable expiry', () => {
    expect(renewDelayMs('not-a-timestamp', NOW)).toBe(MIN_CELL_LOCK_RENEW_DELAY_MS);
  });
});

describe('contendedRetryDelayMs', () => {
  it('waits the whole remaining TTL, not half of it', () => {
    // Half would be asking again while the other client's hold is still valid,
    // which is the polling the `cell:unlocked` broadcast exists to avoid.
    expect(contendedRetryDelayMs(EXPIRES_AT, NOW)).toBe(TTL_MS);
    expect(contendedRetryDelayMs(EXPIRES_AT, NOW)).toBeGreaterThan(renewDelayMs(EXPIRES_AT, NOW));
  });

  it('never schedules faster than the floor, even for an expiry in the past', () => {
    // Without the floor this is a busy loop and not a slow one: the answer to
    // the immediate re-request is `HELD_BY_OTHER` carrying the same past
    // `expiresAt`, which schedules another zero-delay timer.
    expect(contendedRetryDelayMs(new Date(NOW - 60_000).toISOString(), NOW)).toBe(
      MIN_CELL_LOCK_RENEW_DELAY_MS
    );
  });

  it('never returns NaN for an unparseable expiry', () => {
    expect(contendedRetryDelayMs('not-a-timestamp', NOW)).toBe(MIN_CELL_LOCK_RENEW_DELAY_MS);
  });
});
