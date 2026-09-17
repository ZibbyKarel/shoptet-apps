# 0034 – Only one throttler is registered; the stricter tier is an override

**Date:** 2026-08-28 · **Status:** accepted

## What

`ThrottlerModule` registers a **single** throttler named `default`
(`THROTTLE_TTL_MS` / `THROTTLE_LIMIT`, default 300 requests per minute). A stricter tier for
endpoints reachable without a session (`THROTTLE_STRICT_TTL_MS` / `THROTTLE_STRICT_LIMIT`,
default 20 per minute) is **not a second registered throttler**, but the `@StrictThrottle()`
decorator in `apps/garage/api/src/common/throttling/throttle-tiers.ts`, which reconfigures that one
throttler on a given route.

Task 10 **doesn't put the decorator anywhere** – it only prepares it. Which routes get it is
decided by Tasks 11–12 (expected candidates: the ICS feed and the endpoints facing the mock
OIDC server).

`/health/live` and `/health/ready` are exempt from rate limiting via `@SkipThrottle()`.

## Why

`@nestjs/throttler` v6 applies **every registered named throttler to every route**. If the
stricter tier were registered as a second throttler, it would apply globally – the entire
API would run at 20 requests per minute. That's the exact opposite of what "prepared but
unused" means, and it's a mistake that doesn't show up in tests and is only noticed in
production once ordinary users start getting 429s.

The only way to have a named, configurable, and **unapplied** set of limits is to have it as
an override of the existing throttler, i.e. as a decorator.

**Why the values are read through a resolver, not directly.** The decorator is evaluated at
module load time and can't have `ConfigService` injected into it. If `process.env` were read
eagerly in the body of `StrictThrottle()`, it would be read before `ConfigModule` validates
the env. Fortunately, `@nestjs/throttler` accepts a function for `ttl`/`limit`, so the value
is read **per request** – by which point `validateApiEnv` has long since run.

`ENV_DEFAULTS` is imported from `apps/garage/api/src/env.ts`, so that the decorator's fallback and
the Zod schema's `.default()` are the same numbers; a second copy would drift.

**`ttl` is in milliseconds.** In v5 it was seconds. That's also where the `_MS`-suffixed
variable names come from – so the value can't be mistaken when reading a `.env`.

## How

```ts
export function globalThrottlerOptions(env: Pick<ApiEnv, 'THROTTLE_TTL_MS' | 'THROTTLE_LIMIT'>) {
  return [{ name: DEFAULT_THROTTLER_NAME, ttl: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT }];
}

export function StrictThrottle(): MethodDecorator & ClassDecorator {
  return Throttle({
    [DEFAULT_THROTTLER_NAME]: {
      ttl: () => Number(process.env['THROTTLE_STRICT_TTL_MS'] ?? ENV_DEFAULTS.THROTTLE_STRICT_TTL_MS),
      limit: () => Number(process.env['THROTTLE_STRICT_LIMIT'] ?? ENV_DEFAULTS.THROTTLE_STRICT_LIMIT),
    },
  });
}
```

Used in Task 11–12:

```ts
@StrictThrottle()
@Get('ics/:token')
feed() { … }
```

`throttle-tiers.spec.ts` guards the invariant "exactly one is registered" and **calls the
decorator**: it reads the resolvers it installed (metadata `THROTTLER:TTLdefault` /
`THROTTLER:LIMITdefault` on the handler), calls them with `process.env` both set and unset,
and verifies the value changes between the two calls of the same resolver – exactly the
property a number frozen at import time wouldn't have.

An earlier version of this suite claimed the same thing but only checked
`expect(ENV_DEFAULTS.THROTTLE_STRICT_LIMIT).toBe(20)` – i.e. two constants checked against
each other, which holds regardless of whether `StrictThrottle` reads them at all.

## Risk if this is wrong

The counter storage is **in-memory** – that's fine as long as a single instance is running
(which is the MVP's stated target), but under horizontal scaling each instance would count
its own limit, and the effective limit would be multiplied by the number of instances. The
upgrade path is a storage adapter (`ThrottlerStorage`), not a change to this structure;
Redis is deliberately not used in the MVP.

Second risk: once someone adds `@StrictThrottle()` to a first route, the strict limit starts
actually being enforced, and a value set too low in `.env` shows up immediately. Until then,
that variable has no effect, which tempts someone to set it to "something".

Third, and still unresolved: `ThrottlerGuard` buckets by `req.ip`, and because `trust proxy`
isn't set, Express takes the IP from the socket. **Behind a reverse proxy, all clients
therefore share one bucket.** Described in `doc/api-operations.md`; it has to be resolved
before the API runs behind a proxy.
