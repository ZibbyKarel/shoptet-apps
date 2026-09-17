/**
 * The three URLs the browser and the server derive from one env variable.
 *
 * `NEXT_PUBLIC_API_URL` is the API's **base URL, global prefix included**
 * (`http://localhost:3000/api`, see `doc/environment.md`). It is not itself
 * any of the three endpoints the app talks to: the RPC transport sits one
 * segment below it, and the readiness probe and the websocket sit outside the
 * prefix entirely. All three are derived here rather than configured
 * separately — one variable cannot drift from itself.
 */

/**
 * Path segment under the API's global prefix that carries the oRPC transport.
 *
 * Mirrors `RPC_ROUTE_PREFIX` in `apps/garage/api/src/orpc/rpc-route.ts`, which cannot
 * be imported from here (the module boundary keeps `apps/garage/web` out of
 * `apps/garage/api`, and rightly: a shared constant would make the *client* the
 * authority on a *server* mount point). The parity is instead pinned by
 * `api-url.spec.ts` and measured — see {@link apiRpcUrl}.
 */
export const API_RPC_SEGMENT = 'rpc';

/**
 * Path of the API's readiness probe.
 *
 * **Not** `/api/health/ready`. `configureApp()` passes the health prefix to
 * `setGlobalPrefix`'s `exclude`, so the probes sit at the server root while
 * every procedure sits under `/api` (`apps/garage/api/src/health/health.controller.ts`,
 * `doc/auth.md` §Public routes). Building this path off the configured URL
 * *including* its prefix is the mistake that produces a health check which is
 * red on a perfectly healthy deployment.
 */
export const API_READINESS_PATH = '/health/ready';

/**
 * Origin of the API — scheme, host and port, with no path.
 *
 * This is what Socket.io needs. `io(url)` reads a path in the URL as a
 * **namespace**, not as a mount point: handing it `http://host/api` would make
 * the client dial the `/api` namespace, which the gateway (Task 15) does not
 * register, and the handshake would be refused for a reason that looks like an
 * auth failure. `RealtimeSocketOptions.url` is documented as "origin of the
 * API" for exactly this reason; the Socket.io mount point is its separate
 * `path` option, which defaults to `DEFAULT_SOCKET_PATH`.
 *
 * @throws {TypeError} when `apiUrl` is not an absolute URL. It always is —
 * `apps/garage/web/src/env.ts` validates it with `z.url()` before the server serves
 * anything — so a throw here means the schema was bypassed.
 */
export function apiOriginOf(apiUrl: string): string {
  return new URL(apiUrl).origin;
}

/**
 * `apiOriginOf`, but never throws.
 *
 * `apiOriginOf` throws on a URL that is not absolute — impossible in a booted
 * process, since `apps/garage/web/src/env.ts` validates `NEXT_PUBLIC_API_URL` with
 * `z.url()` first — except during a build-time render with no environment at
 * all, where an empty string is the honest answer. `app/layout.tsx` needs it
 * so the socket simply stays closed rather than throwing (which would render
 * the error boundary for every route, login page included); `settings/page.tsx`
 * needs it so the ICS section falls back to its "unavailable" copy instead of
 * a broken link. One helper rather than two hand-copied try/catch blocks.
 */
export function apiOriginOrEmpty(apiUrl: string): string {
  try {
    return apiOriginOf(apiUrl);
  } catch {
    return '';
  }
}

/** Absolute URL of the API's readiness probe. See {@link API_READINESS_PATH}. */
export function apiReadinessUrl(apiUrl: string): string {
  return new URL(API_READINESS_PATH, apiOriginOf(apiUrl)).toString();
}

/**
 * Base URL for `createApiClient` — the configured API URL plus `/rpc`.
 *
 * `RPCLink` appends the procedure's key path in the contract router to this
 * base, so the base must be everything in front of that key path.
 * `MeController` is `@Controller('rpc')` with `@Post('me/get')` under the
 * global prefix `api`, which puts the procedure at `POST /api/rpc/me/get`.
 *
 * Handing the configured URL straight to `createApiClient` therefore calls
 * `POST /api/me/get`, and **every** request 404s. That is not a deduction:
 * against the API running on `localhost:3000`, `POST /api/me/get` answered
 * `404` and `POST /api/rpc/me/get` answered `401 Unauthorized` (i.e. the route
 * exists and the guard ran). The mistake is invisible in a unit test that
 * stubs `fetch`, because a stub answers whatever URL it is given.
 */
export function apiRpcUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/u, '')}/${API_RPC_SEGMENT}`;
}
