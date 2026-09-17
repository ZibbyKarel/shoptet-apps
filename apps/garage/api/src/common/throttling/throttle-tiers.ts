/**
 * Rate-limiting tiers.
 *
 * Only **one** throttler is registered globally (`DEFAULT_THROTTLER_NAME`).
 * `@nestjs/throttler` applies every *registered* named throttler to every
 * route, so registering a second, stricter one would rate-limit the whole API
 * at the strict limit — the opposite of "prepared but unapplied".
 *
 * The strict tier is therefore an **override** of the same throttler, expressed
 * as the `@StrictThrottle()` decorator below. Tasks 11–12 put it on the routes
 * that run without a session (the ICS feed and the mock-OIDC-facing endpoints
 * are the expected candidates); this task deliberately does not guess which.
 *
 * Windows are milliseconds, which is what `@nestjs/throttler` v6 expects.
 */

import { Throttle } from '@nestjs/throttler';
import type { ApiEnv } from '../../env';
import { ENV_DEFAULTS } from '../../env';

/**
 * The name of the single registered throttler. `'default'` is what
 * `@Throttle()`/`@SkipThrottle()` assume when a throttler is registered
 * without a name, so it is spelled out here rather than left implicit.
 */
export const DEFAULT_THROTTLER_NAME = 'default';

/** Builds the `ThrottlerModule.forRoot` argument from validated env. */
export function globalThrottlerOptions(env: Pick<ApiEnv, 'THROTTLE_TTL_MS' | 'THROTTLE_LIMIT'>) {
  return [
    {
      name: DEFAULT_THROTTLER_NAME,
      ttl: env.THROTTLE_TTL_MS,
      limit: env.THROTTLE_LIMIT,
    },
  ];
}

/**
 * The stricter tier for endpoints reachable without a session — **prepared,
 * applied nowhere.** Tasks 11–12 decide which routes get it:
 *
 * ```ts
 * ‍@StrictThrottle()
 * ‍@Get('ics/:token')
 * feed() { … }
 * ```
 *
 * `@nestjs/throttler` accepts a resolver for `ttl`/`limit`, so the numbers are
 * read from `process.env` **per request**, not frozen at import time. A
 * decorator cannot inject `ConfigService`, and reading env eagerly here would
 * capture the value before `ConfigModule` had validated it. `validateApiEnv`
 * has already run by the time a request arrives, so an invalid value cannot
 * reach these resolvers; the `ENV_DEFAULTS` fallback covers the key simply
 * being unset.
 */
export function StrictThrottle(): MethodDecorator & ClassDecorator {
  return Throttle({
    [DEFAULT_THROTTLER_NAME]: {
      ttl: () =>
        Number(process.env['THROTTLE_STRICT_TTL_MS'] ?? ENV_DEFAULTS.THROTTLE_STRICT_TTL_MS),
      limit: () =>
        Number(process.env['THROTTLE_STRICT_LIMIT'] ?? ENV_DEFAULTS.THROTTLE_STRICT_LIMIT),
    },
  });
}
