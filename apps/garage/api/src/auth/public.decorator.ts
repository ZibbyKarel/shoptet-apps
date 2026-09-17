/**
 * Marks a route as reachable without a bearer token.
 *
 * ## Why an opt-out and not an opt-in
 *
 * `JwtAuthGuard` is registered as an `APP_GUARD`, so **every** route is
 * authenticated by default and a new controller is protected the moment it is
 * written. The alternative — decorating each protected route — makes a
 * forgotten decorator into an open endpoint, which is exactly the failure this
 * ordering removes.
 *
 * ## Why this is not a test backdoor
 *
 * It is route metadata, evaluated identically in dev, e2e and production. There
 * is no environment in which it turns on, and nothing it can be set from at
 * runtime. It exists for the two kinds of route that genuinely cannot carry an
 * `Authorization` header:
 *
 * - the orchestrator's liveness and readiness probes (`HealthController`);
 * - the personal ICS feed (Task 12), which calendar clients fetch with no
 *   header at all and which authenticates on the secret in its own URL —
 *   and which therefore also carries `@StrictThrottle()`.
 *
 * A `@Public()` route gets **no** `request.user`. `RolesGuard` fails closed on
 * that, so `@Public()` next to `@Roles('ADMIN')` denies rather than allows.
 */

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'garage:auth:public';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
