/**
 * Node.js-only half of `./instrumentation.ts`. Runs `validateWebEnv` as soon
 * as the module is loaded (i.e. once, when the server boots) and force-exits
 * the process on failure.
 *
 * Next.js catches errors thrown out of `register()` and logs "Failed to
 * prepare server" — but then keeps the server listening and serving 500s
 * instead of exiting, which is not fail-fast. `process.exit(1)` forces a
 * real crash so a missing/invalid variable actually takes the process down,
 * the same way a NestJS `ConfigModule` validation failure does on the API
 * side.
 */
import { validateWebEnv } from './env';

try {
  validateWebEnv();
} catch (error) {
  // `no-console` is only enforced in apps/garage/api/** and libs/** (see
  // eslint.config.mjs) — apps/garage/web has no nestjs-pino equivalent yet, and
  // this is the last line executed before the process exits regardless.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
