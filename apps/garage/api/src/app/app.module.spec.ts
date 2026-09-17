/**
 * A dependency-injection smoke test.
 *
 * `AppModule` wires the whole operational baseline together, and a broken
 * provider graph — a missing `@Global()`, an indicator asking for a service its
 * module does not import — compiles cleanly, lints cleanly and then fails at
 * boot. Compiling the module here catches that without a database: `compile()`
 * resolves every provider but does not run `onModuleInit`, so nothing tries to
 * open a connection.
 *
 * The database *is* stubbed, which is the honest limit of this test: it proves
 * the graph resolves, not that Postgres is reachable. Docker was unavailable in
 * this environment, so the connect path itself is unexercised.
 */

import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ContractExceptionFilter } from '../common/filters/contract-exception.filter';
import { ENV_DEFAULTS } from '../env';
import { PrismaService } from '../database/prisma.service';
import { DatabaseHealthIndicator } from '../health/database.health-indicator';
import { HealthController } from '../health/health.controller';
import { GracefulShutdownService } from '../shutdown/graceful-shutdown.service';

const ENV = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://garage:garage@localhost:5432/garage',
  AUTH_OKTA_ISSUER: 'http://localhost:8080/default',
  AUTH_OKTA_AUDIENCE: 'api://default',
  CORS_ALLOWED_ORIGINS: 'http://localhost:4200',
  // Quietest level the schema allows; `silent` is deliberately not in the enum.
  LOG_LEVEL: 'fatal',
};

describe('AppModule', () => {
  let moduleRef: TestingModule;
  let appModule: new () => unknown;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    // `ConfigModule.forRoot({ validate })` runs `validateApiEnv` while the
    // decorator is evaluated — that is, at *import* time. A static import of
    // `AppModule` would therefore validate before this line could set anything,
    // so the module is loaded dynamically after the environment is in place.
    // (That eager validation is the point of fail-fast env: it is asserted in
    // `env.spec.ts`.)
    Object.assign(process.env, ENV);
    const { AppModule } = await import('./app.module');
    appModule = AppModule;

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Replacing the service, not the client: constructing the real one opens
      // a `pg` pool, and no Postgres is available here.
      .overrideProvider(PrismaService)
      .useValue({ ping: jest.fn(), onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
    process.env = originalEnv;
  });

  describe('ConfigService returns Zod-transformed values, not raw strings', () => {
    // `main.ts` passes these straight to `enableCors` and to the body parser.
    // If `@nestjs/config` ever changed its lookup precedence and started
    // returning `process.env`'s raw strings, `enableCors` would receive the
    // string "http://localhost:4200" where it expects an array — which it
    // silently accepts as a single origin, and CORS would keep working just
    // differently enough to matter. Nothing else asserts this.
    it('parses CORS_ALLOWED_ORIGINS into an array', () => {
      const config = moduleRef.get(ConfigService);

      expect(config.get('CORS_ALLOWED_ORIGINS')).toEqual(['http://localhost:4200']);
    });

    it('coerces the numeric keys to numbers', () => {
      const config = moduleRef.get(ConfigService);

      expect(config.get('PORT')).toBe(3000);
      expect(config.get('HEALTH_DB_TIMEOUT_MS')).toBe(ENV_DEFAULTS.HEALTH_DB_TIMEOUT_MS);
      expect(config.get('THROTTLE_LIMIT')).toBe(ENV_DEFAULTS.THROTTLE_LIMIT);
    });

    it('applies the schema defaults for keys absent from the environment', () => {
      const config = moduleRef.get(ConfigService);

      // These are not in `ENV` above, so this proves the `.default()`s reach
      // the running application rather than only the schema.
      expect(config.get('BODY_LIMIT')).toBe(ENV_DEFAULTS.BODY_LIMIT);
    });
  });

  it.each([
    ['the graceful-shutdown registry', GracefulShutdownService],
    ['the readiness indicator', DatabaseHealthIndicator],
    ['the health controller', HealthController],
  ])('resolves %s', (_name, token) => {
    expect(moduleRef.get(token)).toBeDefined();
  });

  // `APP_FILTER` / `APP_GUARD` providers are re-keyed internally by Nest and
  // are not retrievable through `moduleRef.get()`, so the registration is
  // asserted on the module's declared metadata instead. That is still the thing
  // that matters: both must be registered *globally*, or parts of the app would
  // silently run unfiltered and unthrottled.
  it.each([
    ['the exception filter', APP_FILTER, ContractExceptionFilter],
    ['the throttler guard', APP_GUARD, ThrottlerGuard],
  ])('registers %s globally', (_name, token, implementation) => {
    const providers =
      (Reflect.getMetadata('providers', appModule) as Array<Record<string, unknown>>) ?? [];

    expect(providers).toContainEqual({ provide: token, useClass: implementation });
  });
});
