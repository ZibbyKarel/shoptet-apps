/**
 * The assembled HTTP pipeline, driven with real requests.
 *
 * **Why this file exists.** Review found two defects that every unit test in
 * this app missed, because they only appear once a request travels through the
 * real stack: an oversized body came back as 500 instead of 413, and a failing
 * readiness probe had its payload overwritten with the constant 500 body. Both
 * are properties of the *composition* — body parser → filter, terminus →
 * filter — and calling a controller method directly cannot see either.
 *
 * So this boots a genuine Nest HTTP server on an ephemeral port, wired by the
 * same `configureApp` that `main.ts` calls, with the same `APP_FILTER` and
 * `APP_GUARD` as `AppModule`, and drives it with `fetch`.
 *
 * The database is a stub — Docker is unavailable here — but nothing else is:
 * the filter, the health controller, the indicator, the throttler, helmet, CORS
 * and the body parsers are all the real ones.
 */

import type { INestApplication } from '@nestjs/common';
import { Body, Controller, Post } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { AddressInfo } from 'node:net';
import { LoggerModule } from 'nestjs-pino';
import { ContractExceptionFilter } from '../common/filters/contract-exception.filter';
import { configureApp } from '../configure-app';
import { PrismaService } from '../database/prisma.service';
import { DatabaseHealthIndicator } from '../health/database.health-indicator';
import { HealthController } from '../health/health.controller';

const BODY_LIMIT = '1kb';
const ALLOWED_ORIGIN = 'http://localhost:4200';
const HEALTH_DB_TIMEOUT_MS = 50;

class PrismaStub {
  behaviour: 'up' | 'down' = 'up';
  async ping(): Promise<void> {
    if (this.behaviour === 'down') {
      throw new Error('connect ECONNREFUSED 10.0.0.7:5432 for user "garage"');
    }
  }
}

/** A route that exists only so the pipeline has something to accept a body. */
@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: unknown): unknown {
    return { received: body };
  }
}

describe('assembled HTTP pipeline', () => {
  let app: INestApplication;
  let prisma: PrismaStub;
  let baseUrl: string;

  beforeAll(async () => {
    prisma = new PrismaStub();

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
        TerminusModule.forRoot({ errorLogStyle: 'json', logger: false }),
        // A limit high enough not to interfere; the throttler is here so that
        // APP_GUARD is exercised, not to test rate limiting.
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1_000 }]),
      ],
      controllers: [HealthController, EchoController],
      providers: [
        DatabaseHealthIndicator,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => HEALTH_DB_TIMEOUT_MS } },
        { provide: APP_FILTER, useClass: ContractExceptionFilter },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    // The same function main.ts calls — not a re-implementation of it.
    configureApp(app, {
      BODY_LIMIT,
      CORS_ALLOWED_ORIGINS: [ALLOWED_ORIGIN],
    });

    await app.init();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('body size limit (regression: this returned 500)', () => {
    it('answers 413, not 500, when the body exceeds BODY_LIMIT', async () => {
      const response = await fetch(`${baseUrl}/api/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pad: 'x'.repeat(4096) }),
      });

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({
        statusCode: 413,
        message: 'request entity too large',
      });
    });

    it('accepts a body under the limit', async () => {
      const response = await fetch(`${baseUrl}/api/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      });

      expect(response.status).toBe(201);
      // Proves the hand-registered parser actually parsed, rather than the
      // route merely being reachable.
      await expect(response.json()).resolves.toEqual({ received: { hello: 'world' } });
    });

    it('still answers 400 for malformed JSON', async () => {
      const response = await fetch(`${baseUrl}/api/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('/health/ready (regression: the body was overwritten with a 500)', () => {
    it('answers 200 with the check result when the database is up', async () => {
      prisma.behaviour = 'up';

      const response = await fetch(`${baseUrl}/health/ready`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: 'ok',
        details: { database: { status: 'up' } },
      });
    });

    it('answers 503 carrying the health payload, not the constant 500 body', async () => {
      prisma.behaviour = 'down';

      const response = await fetch(`${baseUrl}/health/ready`);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      // The whole point: the reason the indicator worked to produce must reach
      // whoever reads the probe.
      expect(body).toMatchObject({
        status: 'error',
        details: { database: { status: 'down', reason: 'Database is unreachable' } },
      });
      expect(body).not.toHaveProperty('statusCode', 500);
      expect(body['message']).not.toBe('Internal server error');
    });

    it('does not leak the driver error through the assembled response', async () => {
      prisma.behaviour = 'down';

      const response = await fetch(`${baseUrl}/health/ready`);
      const raw = await response.text();

      expect(raw).not.toContain('10.0.0.7');
      expect(raw).not.toContain('garage');
      expect(raw).not.toContain('ECONNREFUSED');
    });
  });

  describe('/health/live', () => {
    it('stays 200 while the database is down — an outage must not restart the process', async () => {
      prisma.behaviour = 'down';

      const response = await fetch(`${baseUrl}/health/live`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
    });
  });

  describe('global prefix', () => {
    it('serves application routes under /api and nothing outside it', async () => {
      const prefixed = await fetch(`${baseUrl}/api/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const bare = await fetch(`${baseUrl}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(prefixed.status).toBe(201);
      expect(bare.status).toBe(404);
    });

    it('keeps the probes outside the prefix', async () => {
      prisma.behaviour = 'up';

      await expect(fetch(`${baseUrl}/health/live`).then((r) => r.status)).resolves.toBe(200);
      await expect(fetch(`${baseUrl}/api/health/live`).then((r) => r.status)).resolves.toBe(404);
    });
  });

  describe('security headers and CORS', () => {
    it('sets helmet headers', async () => {
      const response = await fetch(`${baseUrl}/health/live`);

      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    });

    it('echoes an allowed origin and refuses an unlisted one', async () => {
      const allowed = await fetch(`${baseUrl}/health/live`, {
        headers: { origin: ALLOWED_ORIGIN },
      });
      const denied = await fetch(`${baseUrl}/health/live`, {
        headers: { origin: 'https://evil.example' },
      });

      expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
