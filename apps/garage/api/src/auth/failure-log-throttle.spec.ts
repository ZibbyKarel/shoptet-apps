/**
 * The log-volume control, tested with a controllable clock.
 *
 * It is split out of `JwksVerifierService` precisely so that "one line a
 * minute, carrying the count of what it swallowed" can be exercised over
 * simulated time. Faking timers inside the verifier's own spec is not an
 * option — that suite talks to a real HTTP issuer over real sockets.
 */

import { FailureLogThrottle } from './failure-log-throttle';

type Kind = 'a' | 'b';

const INTERVAL_MS = 60_000;

function throttleWithClock(): {
  throttle: FailureLogThrottle<Kind>;
  advance: (milliseconds: number) => void;
} {
  let now = 1_000_000;
  const throttle = new FailureLogThrottle<Kind>(INTERVAL_MS, () => now);
  return {
    throttle,
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
}

describe('FailureLogThrottle', () => {
  it('logs the first occurrence immediately', () => {
    const { throttle } = throttleWithClock();

    expect(throttle.record('a')).toEqual({ shouldLog: true, suppressedSinceLastLog: 0 });
  });

  it('stays quiet for the rest of the interval', () => {
    const { throttle, advance } = throttleWithClock();
    throttle.record('a');

    advance(INTERVAL_MS - 1);

    expect(throttle.record('a').shouldLog).toBe(false);
  });

  it('reports how many it swallowed on the next line that gets through', () => {
    const { throttle, advance } = throttleWithClock();
    throttle.record('a');
    for (let index = 0; index < 4126; index += 1) {
      throttle.record('a');
    }

    advance(INTERVAL_MS);

    // The point of the whole class: an operator sees the blast radius of an
    // outage without 4127 lines being written.
    expect(throttle.record('a')).toEqual({
      shouldLog: true,
      suppressedSinceLastLog: 4126,
    });
  });

  it('resets the count after a line gets through', () => {
    const { throttle, advance } = throttleWithClock();
    throttle.record('a');
    throttle.record('a');
    advance(INTERVAL_MS);
    throttle.record('a');

    advance(INTERVAL_MS);

    expect(throttle.record('a').suppressedSinceLastLog).toBe(0);
  });

  it('throttles each kind independently', () => {
    const { throttle } = throttleWithClock();
    throttle.record('a');

    // A second, different problem starting during the first one's quiet period
    // must not be hidden by it.
    expect(throttle.record('b').shouldLog).toBe(true);
    expect(throttle.record('a').shouldLog).toBe(false);
  });

  it('keeps a quiet line free of the suppressed field', () => {
    const { throttle, advance } = throttleWithClock();
    throttle.record('a');

    advance(INTERVAL_MS * 10);

    // Nothing happened in between, so there is nothing to report — the caller
    // omits the key entirely rather than logging `suppressedSinceLastLog: 0`.
    expect(throttle.record('a').suppressedSinceLastLog).toBe(0);
  });
});
