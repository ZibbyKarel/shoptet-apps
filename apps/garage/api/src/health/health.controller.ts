/**
 * Liveness and readiness, which mean different things on purpose.
 *
 * - **`GET /health/live`** — is this process running? It touches nothing
 *   external. If it answers, the event loop is alive and the process should not
 *   be restarted. Adding a dependency check here would be a bug: a database
 *   outage would make the orchestrator kill and restart every instance, which
 *   cannot fix a database outage and does guarantee a cold start when it ends.
 *
 * - **`GET /health/ready`** — can this process serve traffic? Here that means
 *   the database is reachable, because every meaningful endpoint reads it. This
 *   returns 503 while Postgres is down, so the instance is taken out of
 *   rotation without being restarted.
 *
 * Both are outside the `api` global prefix (`main.ts` excludes them) and both
 * skip rate limiting: a probe that gets 429'd is reported as a failing
 * instance.
 *
 * Both are also `@Public()`. An orchestrator's probe has no bearer token and no
 * way to obtain one, so authenticating the probes would report every healthy
 * instance as dead. This is a route-level opt-out that behaves identically in
 * dev, e2e and production — not an environment-conditional bypass; see
 * `auth/public.decorator.ts`. The probes expose no data: liveness returns a
 * constant, readiness returns up/down plus a fixed reason string.
 */

import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { DatabaseHealthIndicator } from './database.health-indicator';

/** Route prefix, exported so `main.ts` can exclude it from the global prefix. */
export const HEALTH_ROUTE_PREFIX = 'health';

@Public()
@SkipThrottle()
@Controller(HEALTH_ROUTE_PREFIX)
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator
  ) {}

  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    // An empty check list is intentional — see the class comment.
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.isHealthy('database')]);
  }
}
