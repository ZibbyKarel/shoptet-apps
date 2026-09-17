import 'reflect-metadata';
import { DEFAULT_THROTTLER_NAME, StrictThrottle, globalThrottlerOptions } from './throttle-tiers';
import { ENV_DEFAULTS } from '../../env';

describe('globalThrottlerOptions', () => {
  it('registers exactly one throttler, so the strict tier stays opt-in', () => {
    // `@nestjs/throttler` applies every *registered* named throttler to every
    // route. A second entry here would rate-limit the whole API at the strict
    // limit — the opposite of "prepared but unapplied".
    const options = globalThrottlerOptions({ THROTTLE_TTL_MS: 60_000, THROTTLE_LIMIT: 300 });

    expect(options).toHaveLength(1);
    expect(options[0]?.name).toBe(DEFAULT_THROTTLER_NAME);
  });

  it('passes the window through in milliseconds, which is what v6 expects', () => {
    const options = globalThrottlerOptions({ THROTTLE_TTL_MS: 15_000, THROTTLE_LIMIT: 42 });

    expect(options[0]).toMatchObject({ ttl: 15_000, limit: 42 });
  });
});

/**
 * These call the decorator and run the resolvers it installs. An earlier version
 * of this suite asserted only that two `ENV_DEFAULTS` constants held their
 * literal values — which is true whether or not `StrictThrottle` reads them, and
 * so protected nothing.
 *
 * `@nestjs/throttler` v6 stores per-route overrides as metadata under
 * `` `THROTTLER:TTL${name}` `` / `` `THROTTLER:LIMIT${name}` `` on the handler.
 * The keys are internal, so they are spelled out here rather than imported; the
 * assertions below fail loudly if that ever changes, which is the point.
 */
describe('StrictThrottle', () => {
  const TTL_KEY = `THROTTLER:TTL${DEFAULT_THROTTLER_NAME}`;
  const LIMIT_KEY = `THROTTLER:LIMIT${DEFAULT_THROTTLER_NAME}`;

  /** Applies the decorator to a throwaway method and returns its resolvers. */
  function decorate(): { ttl: () => number; limit: () => number } {
    class Target {
      handler(): void {
        /* noop */
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      Target.prototype,
      'handler'
    ) as PropertyDescriptor;
    StrictThrottle()(Target.prototype, 'handler', descriptor);

    return {
      ttl: Reflect.getMetadata(TTL_KEY, Target.prototype.handler) as () => number,
      limit: Reflect.getMetadata(LIMIT_KEY, Target.prototype.handler) as () => number,
    };
  }

  const originalTtl = process.env['THROTTLE_STRICT_TTL_MS'];
  const originalLimit = process.env['THROTTLE_STRICT_LIMIT'];

  afterEach(() => {
    // `exactOptionalPropertyTypes` aside, deleting is what "unset" means here.
    if (originalTtl === undefined) {
      delete process.env['THROTTLE_STRICT_TTL_MS'];
    } else {
      process.env['THROTTLE_STRICT_TTL_MS'] = originalTtl;
    }
    if (originalLimit === undefined) {
      delete process.env['THROTTLE_STRICT_LIMIT'];
    } else {
      process.env['THROTTLE_STRICT_LIMIT'] = originalLimit;
    }
  });

  it('overrides the one registered throttler rather than adding a second', () => {
    const { ttl, limit } = decorate();

    // Metadata under the `default` name is what makes this an override of the
    // registered throttler instead of a new, globally-applied tier.
    expect(typeof ttl).toBe('function');
    expect(typeof limit).toBe('function');
  });

  it('installs resolvers, not frozen numbers, so env is read per request', () => {
    const { limit } = decorate();

    process.env['THROTTLE_STRICT_LIMIT'] = '7';
    expect(limit()).toBe(7);

    // The same resolver, called again after the value changed — this is the
    // property that a value captured at import time would not have.
    process.env['THROTTLE_STRICT_LIMIT'] = '9';
    expect(limit()).toBe(9);
  });

  it('reads both values from the environment when they are set', () => {
    process.env['THROTTLE_STRICT_TTL_MS'] = '5000';
    process.env['THROTTLE_STRICT_LIMIT'] = '3';

    const { ttl, limit } = decorate();

    expect(ttl()).toBe(5_000);
    expect(limit()).toBe(3);
  });

  it('falls back to ENV_DEFAULTS when the keys are unset', () => {
    delete process.env['THROTTLE_STRICT_TTL_MS'];
    delete process.env['THROTTLE_STRICT_LIMIT'];

    const { ttl, limit } = decorate();

    // The fallback must be the same numbers the Zod schema defaults to; a
    // second copy would mean an unset key silently meant two different limits.
    expect(ttl()).toBe(ENV_DEFAULTS.THROTTLE_STRICT_TTL_MS);
    expect(limit()).toBe(ENV_DEFAULTS.THROTTLE_STRICT_LIMIT);
  });

  it('is stricter than the global tier, or it would not be worth applying', () => {
    const global = globalThrottlerOptions({
      THROTTLE_TTL_MS: ENV_DEFAULTS.THROTTLE_TTL_MS,
      THROTTLE_LIMIT: ENV_DEFAULTS.THROTTLE_LIMIT,
    });

    expect(ENV_DEFAULTS.THROTTLE_STRICT_LIMIT).toBeLessThan(global[0]?.limit ?? 0);
  });
});
