/**
 * The readiness check that actually reaches Postgres.
 *
 * A readiness probe that returns 200 while the database is down is worse than
 * no probe at all: it makes a broken deploy look healthy and lets the
 * orchestrator route traffic to an instance that can only produce 500s. So this
 * indicator issues a real `SELECT 1`.
 *
 * It is wrapped in a timeout because a *hung* Postgres — a full connection
 * pool, a network black hole — makes `SELECT 1` never settle. Without the
 * timeout the probe would hang instead of failing, and a hanging probe reads to
 * most orchestrators as "still starting", not "broken".
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { HealthIndicatorService } from '@nestjs/terminus';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../database/prisma.service';
import type { ApiEnv } from '../env';

/** Rejects with this message when the ping outlives `HEALTH_DB_TIMEOUT_MS`. */
export const DATABASE_HEALTH_TIMEOUT_MESSAGE = 'Database did not respond in time';

/** Prisma's own error codes: `P` and four digits — `P1001`, `P1013`, `P2010`. */
const PRISMA_CODE_PATTERN = /^P\d{4}$/;
/** Postgres SQLSTATE: exactly five upper-case alphanumerics — `28P01`, `53300`. */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/**
 * Why the probe failed, in fields that are safe to write to stdout.
 *
 * Every field is a scalar drawn from a fixed vocabulary or matched against a
 * strict pattern, so none of them can be a connection string. That is the whole
 * design; see the comment in {@link DatabaseHealthIndicator.isHealthy}.
 */
export interface DatabaseProbeFailure {
  /** Constructor name of what was thrown, or its `typeof` if it was not an `Error`. */
  readonly kind: string;
  /** Prisma's `P`-code, or `'none'` when the thrown value carries none. */
  readonly prismaCode: string;
  /** Postgres SQLSTATE — `28P01` is a rejected password — or `'none'`. */
  readonly sqlState: string;
  /** `true` when this indicator's own timer fired rather than the driver answering. */
  readonly timedOut: boolean;
}

function scalarMatching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

/**
 * Reduces a caught probe failure to the scalars that discriminate it.
 *
 * Exported for its own tests: the property that matters — that nothing here can
 * carry a credential — is a property of this function, and asserting it on a
 * realistic Prisma error is cheaper and sharper than driving it through the
 * whole controller.
 *
 * A missing code is reported as the literal `'none'`, never as a fallback to
 * `error.message`. `'none'` is itself diagnostic: it says the failure never
 * reached the driver.
 */
export function describeDatabaseProbeFailure(error: unknown): DatabaseProbeFailure {
  const thrown = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    errorCode?: unknown;
    meta?: unknown;
  };
  const meta = (typeof thrown.meta === 'object' && thrown.meta !== null ? thrown.meta : {}) as {
    code?: unknown;
    dbCode?: unknown;
  };

  return {
    kind: error instanceof Error ? error.constructor.name : typeof error,
    // `PrismaClientKnownRequestError` puts it on `code`;
    // `PrismaClientInitializationError` puts it on `errorCode`.
    prismaCode:
      scalarMatching(thrown.code, PRISMA_CODE_PATTERN) ??
      scalarMatching(thrown.errorCode, PRISMA_CODE_PATTERN) ??
      'none',
    // The driver's SQLSTATE, when the adapter forwarded one through `meta`.
    // This is the field that separates a rotated password from a full pool.
    sqlState:
      scalarMatching(meta.code, SQLSTATE_PATTERN) ??
      scalarMatching(meta.dbCode, SQLSTATE_PATTERN) ??
      'none',
    timedOut: error instanceof Error && error.message === DATABASE_HEALTH_TIMEOUT_MESSAGE,
  };
}

@Injectable()
export class DatabaseHealthIndicator {
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthIndicatorService: HealthIndicatorService,
    configService: ConfigService<ApiEnv, true>,
    @InjectPinoLogger(DatabaseHealthIndicator.name) private readonly logger: PinoLogger
  ) {
    this.timeoutMs = configService.get('HEALTH_DB_TIMEOUT_MS', { infer: true });
  }

  async isHealthy(key = 'database'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const startedAt = Date.now();

    try {
      await this.withTimeout(this.prisma.ping());
      return indicator.up({ responseTimeMs: Date.now() - startedAt });
    } catch (error) {
      // The log is where the *cause* survives. The coarse `reason` below tells
      // an operator that the database is unreachable and nothing more, so
      // without this line a rotated password (`28P01`), a host that no longer
      // resolves and an exhausted pool all present as one indistinguishable
      // symptom — three different fixes behind one 503 and a restart loop.
      //
      // Note what is *not* here: no `err`, no `error.message`. This is the same
      // rule `slack/slack-client.service.ts:277-279` states for the bot token —
      // pino's error serializer copies own properties, so an error object logged
      // whole publishes whatever it transitively holds. A Prisma failure on this
      // path can hold the connection string, which carries the database
      // password; `libs/garage/database/src/lib/disposable-database.ts:82` exists for
      // exactly that reason. `describeDatabaseProbeFailure` is scalars only,
      // each one either from a fixed vocabulary or matched against a strict
      // pattern, so none of them can be that string.
      //
      // The safe shape is also the more useful one. What actually discriminates
      // the three failures is the *code* — `28P01`, `P1001`, `P1013` — and a
      // code is a scalar an operator can alert on, which a serialized blob is
      // not.
      //
      // Deliberately not rate-limited or deduplicated. Probes fire on an
      // interval, so a crash loop repeats this line — that repetition is the
      // signal, not noise.
      this.logger.warn(
        { ...describeDatabaseProbeFailure(error), timeoutMs: this.timeoutMs },
        'Readiness database probe failed'
      );

      // The reason is deliberately coarse. `/health/ready` is usually reachable
      // to more people than the logs are, and a driver error message can carry
      // the host, the database name and occasionally the user.
      //
      // INVARIANT for every indicator added to `/health/ready`: build your own
      // coarse `reason`; never pass a caught error's message to `down()`. The
      // route is unauthenticated and `@SkipThrottle()`d, and the global filter
      // forwards the terminus payload verbatim, so whatever an indicator puts in
      // `reason` is published to anyone who can reach the probe. Six of
      // terminus's own built-ins do the opposite — `TypeOrmHealthIndicator` and
      // `HttpHealthIndicator` among them pass `err.message` straight through —
      // so adding one to the readiness list without wrapping it would leak the
      // driver or upstream error text this indicator exists to suppress.
      return indicator.down({
        reason:
          error instanceof Error && error.message === DATABASE_HEALTH_TIMEOUT_MESSAGE
            ? DATABASE_HEALTH_TIMEOUT_MESSAGE
            : 'Database is unreachable',
        timeoutMs: this.timeoutMs,
      });
    }
  }

  private async withTimeout(promise: Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(DATABASE_HEALTH_TIMEOUT_MESSAGE)), this.timeoutMs);
    });

    try {
      await Promise.race([promise, timeout]);
    } finally {
      // Without this the process keeps an active timer for up to
      // `timeoutMs` after every successful probe.
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
