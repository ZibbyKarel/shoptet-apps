/**
 * API bootstrap.
 *
 * The HTTP-level wiring — prefix, helmet, CORS, body limits, shutdown hooks —
 * lives in `configure-app.ts` so that `http-pipeline.spec.ts` exercises the
 * same code rather than a hand-rebuilt copy of it. What remains here is what
 * only a real process does: create the app, install pino, read the port,
 * listen.
 *
 * `bufferLogs: true` holds Nest's own startup lines until `useLogger` has
 * installed pino, so the boot sequence is JSON like everything else instead of
 * Nest's coloured text.
 */

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import { GLOBAL_PREFIX, configureApp } from './configure-app';
import type { ApiEnv } from './env';

async function bootstrap(): Promise<void> {
  // `bodyParser: false` turns off Nest's own body parser so that the ones
  // registered by `configureApp` are the only ones. Left on, Nest would
  // register a second pair during `init()`; they would no-op behind ours, but
  // only because ours happen to run first — an ordering nobody should have to
  // reason about.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });

  // From here on, every line Nest emits is a pino JSON record.
  app.useLogger(app.get(Logger));

  // `ConfigService` returns values already validated by `validateApiEnv` in
  // `AppModule` — a missing or malformed variable would have crashed the
  // process during `NestFactory.create` above, before reaching here.
  const configService = app.get(ConfigService<ApiEnv, true>);
  const port = configService.get('PORT', { infer: true });

  configureApp(app, {
    BODY_LIMIT: configService.get('BODY_LIMIT', { infer: true }),
    CORS_ALLOWED_ORIGINS: configService.get('CORS_ALLOWED_ORIGINS', { infer: true }),
  });

  await app.listen(port);

  app.get(Logger).log(`API listening on http://localhost:${port}/${GLOBAL_PREFIX}`, 'Bootstrap');
}

void bootstrap();
