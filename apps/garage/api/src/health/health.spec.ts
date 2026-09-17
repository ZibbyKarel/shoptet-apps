/**
 * Health endpoints.
 *
 * These exercise the real `HealthCheckService` and the real
 * `DatabaseHealthIndicator` against a `PrismaService` double, because the
 * property under test is the *difference* between liveness and readiness: with
 * the database down, `/health/live` must still say the process is fine while
 * `/health/ready` must fail. A readiness probe that passes while Postgres is
 * down makes a broken deploy look healthy.
 *
 * Docker is not available in this environment, so the database is a stub. The
 * query it stands in for is a genuine `SELECT 1` (`PrismaService.ping`), and it
 * is asserted here that readiness calls it exactly once per probe.
 *
 * **Scope.** These call the controller directly, so they establish what the
 * indicator and the controller *compute* — how often the database is touched,
 * what the timeout does, what the reason says. They deliberately do **not**
 * claim anything about the HTTP response: review found that the global filter
 * was overwriting the payload asserted here, and a controller-level test cannot
 * see that. The response an orchestrator actually receives is asserted in
 * `apps/garage/api/src/app/http-pipeline.spec.ts`, against a running server.
 */

import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { getLoggerToken } from 'nestjs-pino';
import type { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../database/prisma.service';
import {
  DATABASE_HEALTH_TIMEOUT_MESSAGE,
  DatabaseHealthIndicator,
  describeDatabaseProbeFailure,
} from './database.health-indicator';
import { HealthController } from './health.controller';

const HEALTH_DB_TIMEOUT_MS = 50;

class PrismaStub {
  pings = 0;
  behaviour: 'up' | 'down' | 'hang' = 'up';

  async ping(): Promise<void> {
    this.pings += 1;
    if (this.behaviour === 'down') {
      throw new Error('connect ECONNREFUSED 10.0.0.7:5432 for user "garage"');
    }
    if (this.behaviour === 'hang') {
      await new Promise<void>(() => {
        /* never settles — a full pool or a network black hole */
      });
    }
  }
}

/**
 * What the indicator wrote to the log, in the order it wrote it.
 *
 * Kept as a recording double rather than a spy on a real pino instance so the
 * assertions can read the *bindings object* — the `err` the response is
 * forbidden to carry has to be provably present here, and a serialized log
 * line would only prove that some string contains the host.
 */
interface LogLine {
  readonly bindings: Record<string, unknown>;
  readonly message: string;
}

function recordingLogger(): { logger: PinoLogger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const record =
    () =>
    (bindings: Record<string, unknown>, message: string): void => {
      lines.push({ bindings, message });
    };

  return {
    lines,
    logger: {
      trace: record(),
      debug: record(),
      info: record(),
      warn: record(),
      error: record(),
      fatal: record(),
    } as unknown as PinoLogger,
  };
}

async function createController(
  prisma: PrismaStub,
  logger: PinoLogger = recordingLogger().logger
): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule.forRoot({ errorLogStyle: 'json', logger: false })],
    controllers: [HealthController],
    providers: [
      DatabaseHealthIndicator,
      { provide: PrismaService, useValue: prisma },
      {
        provide: ConfigService,
        useValue: { get: () => HEALTH_DB_TIMEOUT_MS },
      },
      { provide: getLoggerToken(DatabaseHealthIndicator.name), useValue: logger },
    ],
  }).compile();

  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  let prisma: PrismaStub;
  let controller: HealthController;

  beforeEach(async () => {
    prisma = new PrismaStub();
    controller = await createController(prisma);
  });

  // Routing is not asserted here. `expect(HEALTH_ROUTE_PREFIX).toBe('health')`
  // would only check a literal against itself; that the probes really answer
  // outside the `/api` prefix is proved by request in `http-pipeline.spec.ts`.

  describe('/health/live', () => {
    it('reports ok', async () => {
      await expect(controller.live()).resolves.toMatchObject({ status: 'ok' });
    });

    it('does not touch the database — a database outage must not restart the process', async () => {
      prisma.behaviour = 'down';

      await expect(controller.live()).resolves.toMatchObject({ status: 'ok' });
      expect(prisma.pings).toBe(0);
    });
  });

  describe('/health/ready', () => {
    it('reports ok and reaches the database exactly once', async () => {
      const result = await controller.ready();

      expect(result.status).toBe('ok');
      expect(result.details['database']).toMatchObject({ status: 'up' });
      expect(prisma.pings).toBe(1);
    });

    it('fails with 503 when the database is unreachable', async () => {
      prisma.behaviour = 'down';

      // Terminus signals a failed check by throwing 503 — that is what makes
      // an orchestrator take the instance out of rotation.
      const failure = await controller.ready().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ServiceUnavailableException);
      const response = (failure as ServiceUnavailableException).getResponse() as {
        status: string;
        details: Record<string, { status: string; reason?: string }>;
      };
      expect(response.status).toBe('error');
      expect(response.details['database']).toMatchObject({
        status: 'down',
        reason: 'Database is unreachable',
      });
    });

    it('does not leak the driver error — it can carry host, database and user', async () => {
      prisma.behaviour = 'down';

      const failure = await controller.ready().catch((error: unknown) => error);
      const serialized = JSON.stringify((failure as ServiceUnavailableException).getResponse());

      expect(serialized).not.toContain('10.0.0.7');
      expect(serialized).not.toContain('garage');
    });

    it('says the probe failed, in scalars an operator can alert on', async () => {
      // Without this line a crash loop has one symptom and three possible
      // fixes. What discriminates them is the code, not a prose message.
      const recorder = recordingLogger();
      prisma.behaviour = 'down';
      controller = await createController(prisma, recorder.logger);

      await controller.ready().catch(() => undefined);

      expect(recorder.lines).toHaveLength(1);
      const line = recorder.lines[0];
      expect(line?.message).toBe('Readiness database probe failed');
      expect(line?.bindings).toEqual({
        kind: 'Error',
        prismaCode: 'none',
        sqlState: 'none',
        timedOut: false,
        timeoutMs: HEALTH_DB_TIMEOUT_MS,
      });
    });

    it('does not log the error either — a Prisma failure can carry the password', async () => {
      // The regression this pins: the first version of this log line was
      // `{ err: error }`, which pino's serializer expands into whatever the
      // error transitively holds. `PrismaStub` throws a message carrying the
      // host and the user precisely so that a serialized error would be
      // visible here. The rule is the one
      // `slack/slack-client.service.ts:277-279` already states for the bot
      // token, and the response-side leak test above is its twin: BOTH sides
      // are scalars-only now, for different reasons.
      const recorder = recordingLogger();
      prisma.behaviour = 'down';
      controller = await createController(prisma, recorder.logger);

      await controller.ready().catch(() => undefined);

      const serialized = JSON.stringify(recorder.lines);
      expect(serialized).not.toContain('10.0.0.7');
      expect(serialized).not.toContain('garage');
      expect(recorder.lines[0]?.bindings['err']).toBeUndefined();
      expect(recorder.lines[0]?.bindings['message']).toBeUndefined();
    });

    it('says nothing when the probe succeeds — a healthy probe is not a log line', async () => {
      const recorder = recordingLogger();
      controller = await createController(prisma, recorder.logger);

      await controller.ready();

      expect(recorder.lines).toHaveLength(0);
    });

    it('marks a timeout as one, so a hung pool is distinguishable in the logs', async () => {
      const recorder = recordingLogger();
      prisma.behaviour = 'hang';
      controller = await createController(prisma, recorder.logger);

      await controller.ready().catch(() => undefined);

      expect(recorder.lines).toHaveLength(1);
      expect(recorder.lines[0]?.bindings).toMatchObject({ timedOut: true });
    });

    it('fails fast instead of hanging when the database never answers', async () => {
      prisma.behaviour = 'hang';

      const startedAt = Date.now();
      const failure = await controller.ready().catch((error: unknown) => error);
      const elapsed = Date.now() - startedAt;

      expect(failure).toBeInstanceOf(ServiceUnavailableException);
      const response = (failure as ServiceUnavailableException).getResponse() as {
        details: Record<string, { reason?: string }>;
      };
      expect(response.details['database']?.reason).toBe(DATABASE_HEALTH_TIMEOUT_MESSAGE);
      // A hanging probe reads as "still starting" to most orchestrators, which
      // is the wrong answer; it has to fail inside the configured window.
      expect(elapsed).toBeLessThan(HEALTH_DB_TIMEOUT_MS * 10);
    });
  });
});

/**
 * The descriptor is tested directly because the property that matters — that
 * nothing it returns can be a credential — is a property of the function, and
 * the shapes worth checking are Prisma error shapes the `PrismaStub` cannot
 * produce.
 */
describe('describeDatabaseProbeFailure', () => {
  it('lifts the Prisma code and SQLSTATE out of a rejected password', () => {
    // The shape a rotated password arrives in: `P2010` from Prisma with the
    // driver's `28P01` in `meta`, and a message naming host and user.
    const error = Object.assign(
      new Error('Raw query failed. Code: `28P01`. Message: password authentication failed'),
      { code: 'P2010', meta: { code: '28P01', message: 'FATAL: password authentication failed' } }
    );

    expect(describeDatabaseProbeFailure(error)).toEqual({
      kind: 'Error',
      prismaCode: 'P2010',
      sqlState: '28P01',
      timedOut: false,
    });
  });

  it('reads the initialization error code, where Prisma puts it on errorCode', () => {
    const error = Object.assign(new Error('Could not parse the database URL'), {
      errorCode: 'P1013',
    });

    expect(describeDatabaseProbeFailure(error)).toMatchObject({ prismaCode: 'P1013' });
  });

  it('returns nothing that could be a connection string', () => {
    // Every field is a scalar from a fixed vocabulary or a strict pattern. A
    // driver that puts the DSN where a code belongs must not get it published:
    // that is what the patterns are for, and this is the assertion that would
    // have caught the `{ err: error }` version of this log line.
    const dsn = 'postgresql://garage:s3cret@10.0.0.7:5432/garage';
    const error = Object.assign(new Error(`connect ECONNREFUSED for ${dsn}`), {
      code: dsn,
      errorCode: dsn,
      meta: { code: dsn, dbCode: dsn, message: dsn },
    });

    const serialized = JSON.stringify(describeDatabaseProbeFailure(error));

    expect(serialized).not.toContain('s3cret');
    expect(serialized).not.toContain('10.0.0.7');
    expect(serialized).not.toContain('garage');
    expect(describeDatabaseProbeFailure(error)).toMatchObject({
      prismaCode: 'none',
      sqlState: 'none',
    });
  });

  it('says `none` rather than falling back to the message when there is no code', () => {
    // `none` is diagnostic in its own right: the failure never reached a driver.
    expect(describeDatabaseProbeFailure(new Error('boom'))).toEqual({
      kind: 'Error',
      prismaCode: 'none',
      sqlState: 'none',
      timedOut: false,
    });
  });

  it('survives a thrown non-Error without inventing a shape', () => {
    expect(describeDatabaseProbeFailure('boom')).toEqual({
      kind: 'string',
      prismaCode: 'none',
      sqlState: 'none',
      timedOut: false,
    });
  });

  it("recognises this indicator's own timeout", () => {
    expect(describeDatabaseProbeFailure(new Error(DATABASE_HEALTH_TIMEOUT_MESSAGE))).toMatchObject({
      timedOut: true,
    });
  });
});
