/**
 * The HTTP-level configuration of the API.
 *
 * This lives apart from `main.ts` for one reason: **the tests must exercise the
 * real wiring, not a copy of it.** The two defects found in review — an
 * oversized body answering 500 instead of 413, and a failing readiness probe
 * having its payload overwritten — were both invisible to unit tests that call
 * a controller method directly, and both were reachable the moment a real
 * request went through the assembled pipeline. A test that reassembles the
 * pipeline by hand would have drifted from `main.ts` and hidden them just as
 * well, so `main.ts` and `http-pipeline.spec.ts` both call this function.
 *
 * Everything here needs the `INestApplication` itself, which is why it cannot
 * live in `AppModule`. The filter, the throttler guard and the logger *module*
 * are wired in `AppModule` instead, so that module-level tests get them too.
 */

import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import type { ApiEnv } from './env';
import { HEALTH_ROUTE_PREFIX } from './health/health.controller';
import { configureRealtime } from './realtime/realtime-io.adapter';

/** Everything the API serves lives under `/api`, except the probes. */
export const GLOBAL_PREFIX = 'api';

/** The probe paths, excluded from {@link GLOBAL_PREFIX}. */
export const HEALTH_ROUTES = [
  `${HEALTH_ROUTE_PREFIX}/live`,
  `${HEALTH_ROUTE_PREFIX}/ready`,
] as const;

export type HttpConfig = Pick<ApiEnv, 'BODY_LIMIT' | 'CORS_ALLOWED_ORIGINS'>;

/**
 * Applies prefix, helmet, CORS, body-size limits and shutdown hooks.
 *
 * `enableShutdownHooks()` is called here — i.e. **before** `listen()` in
 * `main.ts` — so a SIGTERM arriving during startup is still handled.
 */
export function configureApp(app: INestApplication, config: HttpConfig): void {
  app.setGlobalPrefix(GLOBAL_PREFIX, {
    // Probes stay at `/health/live` and `/health/ready`. They are consumed by
    // an orchestrator, not by the API's clients, and burying them under the
    // application's own prefix couples a deployment probe path to a decision
    // about API routing.
    exclude: [...HEALTH_ROUTES],
  });

  app.use(helmet());

  // An explicit allow-list, never `origin: true` and never `*`: the API is
  // cookie/bearer authenticated, so a reflected origin is a CSRF surface.
  app.enableCors({
    origin: config.CORS_ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Payload limits. The default body-parser limit is 100kb, but it is set here
  // explicitly and from env so that it is visible and tunable rather than an
  // inherited default nobody knows about. An oversized body is rejected before
  // any handler runs; the parser raises `http-errors`' `PayloadTooLargeError`,
  // which `ContractExceptionFilter` turns into a 413 (it is not an
  // `HttpException`, so the filter has to recognise it explicitly).
  app.use(json({ limit: config.BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: config.BODY_LIMIT }));

  // The Socket.io server (Task 15). Here rather than in `main.ts` for this
  // file's whole reason to exist: the specs that stand up the assembled
  // application get the *same* socket server the running one does — the same
  // path, the same CORS allow-list — instead of a hand-rebuilt copy that can
  // drift. It must run before `init()`/`listen()`, which is when Nest reads the
  // adapter to instantiate gateways.
  configureRealtime(app, { CORS_ALLOWED_ORIGINS: config.CORS_ALLOWED_ORIGINS });

  // Stop accepting connections on SIGTERM/SIGINT, let in-flight requests
  // finish, then run `onModuleDestroy` (closes the database pool) and
  // `onApplicationShutdown` (`GracefulShutdownService`, which Task 15 uses to
  // close Socket.io).
  app.enableShutdownHooks();
}
