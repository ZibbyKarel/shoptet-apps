/**
 * This application's one Auth.js instance.
 *
 * `libs/garage/auth` owns `next-auth` and reads no environment variable of its own
 * (`doc/auth.md`, §Environment); the four values it needs are read here and
 * passed in as arguments. That is what keeps Auth.js's implicit `AUTH_SECRET` /
 * `AUTH_OKTA_ID` / `AUTH_OKTA_SECRET` inference from picking anything up
 * behind `webEnvSchema`'s back — the names are declared in one schema and
 * handed over explicitly, never discovered.
 *
 * Neither secret carries a `NEXT_PUBLIC_` prefix, and this module is imported
 * only from server files (`proxy.ts`, the Auth.js route handler, Server
 * Components and Server Actions) — the browser half of the wrapper is
 * `@garage/auth/client`, which reaches the session over
 * `/api/auth/session` instead.
 *
 * ## Why `process.env` rather than `validateWebEnv()`
 *
 * Fail-fast validation of the whole schema happens once, at server boot, in
 * `instrumentation.ts` → `register()`, and `instrumentation-node.ts` calls
 * `process.exit(1)` on failure — so no request is ever served by a process
 * whose configuration did not pass `webEnvSchema`
 * (`doc/decision/0008-*`, `doc/environment.md`). Calling the validator *here*
 * as well would move that check into `next build`, which
 * `doc/decision/0008-*` verified and documented as env-free: Next.js imports
 * route modules while collecting page data, so a module-scope `validateWebEnv()`
 * would make a build require production secrets. Reading the raw values keeps
 * the schema the one gate and the build free of them.
 *
 * The `?? ''` fallbacks therefore never reach Okta: a process that got that far
 * with an empty `AUTH_SECRET` has already been killed by the boot check.
 */

import { createAuth } from '@garage/auth';
import { LOGIN_ROUTE } from './routes';

export const { handlers, auth, signIn, signOut, getAccessToken } = createAuth({
  issuer: process.env.AUTH_OKTA_ISSUER ?? '',
  clientId: process.env.AUTH_OKTA_CLIENT_ID ?? '',
  clientSecret: process.env.AUTH_OKTA_CLIENT_SECRET ?? '',
  secret: process.env.AUTH_SECRET ?? '',
  // Auth.js redirects an unauthorized request here instead of serving its own
  // built-in sign-in page. Shared with `proxy.ts`, which must exempt the same
  // path from the session check — see `./routes.ts`.
  signInPath: LOGIN_ROUTE,
});
