import { apiReadinessUrl } from '../../../api-url';

/**
 * This application's readiness probe.
 *
 * **Readiness, not liveness.** `apps/garage/web` renders nothing a person can use
 * without the API — every screen reads it — so an instance that cannot reach
 * the API should be taken out of rotation. It should *not* be restarted, which
 * is why this answers 503 rather than crashing, and why liveness is left to
 * the fact that the route answers at all. That is the same split
 * `apps/garage/api`'s `/health/live` and `/health/ready` make on purpose.
 *
 * **Public.** An orchestrator's probe carries no bearer token and no way to
 * obtain one, so `src/proxy.ts` excludes this path from the session check —
 * the same reasoning that makes the API's probes `@Public()` (`doc/auth.md`,
 * §Public routes).
 *
 * **It exposes nothing.** The body is a status and a fixed reason string. No
 * URL, no exception message, no stack: a probe is reachable by anyone who can
 * reach the port, and "the API is at this address and here is what it said" is
 * an answer for an operator reading logs, not for an anonymous caller.
 */

/**
 * How long to wait for the API's readiness probe.
 *
 * Milliseconds, hence the suffix (`doc/environment.md`). A constant rather
 * than an env variable: a probe timeout is a property of the probe, and a
 * value nobody would ever set per-deployment does not earn a key in a schema
 * that is only allowed to grow. It sits below the API's own
 * `HEALTH_DB_TIMEOUT_MS` default of 3000 ms plus its round trip, so a slow
 * database reads as `not-ready` there and as `timeout` here rather than
 * hanging this probe until the orchestrator gives up on it.
 */
export const UPSTREAM_TIMEOUT_MS = 4_000;

/** Why the API is not ready. A closed set — never an exception's message. */
export type UpstreamFailure = 'unreachable' | 'timeout' | 'not-ready' | 'not-configured';

export interface HealthBody {
  readonly status: 'ok' | 'error';
  readonly checks: {
    readonly api: { readonly status: 'up' } | { readonly status: 'down'; readonly reason: string };
  };
}

/**
 * Never prerendered and never cached: a probe that answers from a build-time
 * snapshot is a probe that reports a healthy instance forever.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const failure = await checkApi();

  const body: HealthBody =
    failure === null
      ? { status: 'ok', checks: { api: { status: 'up' } } }
      : { status: 'error', checks: { api: { status: 'down', reason: failure } } };

  return Response.json(body, {
    status: failure === null ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}

/** `null` when the API is ready; otherwise why it is not. */
async function checkApi(): Promise<UpstreamFailure | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl === undefined || apiUrl === '') {
    // Unreachable in a booted process — `webEnvSchema` requires this variable
    // and `instrumentation-node.ts` exits without it — so this branch exists
    // to be honest rather than to be taken.
    return 'not-configured';
  }

  let url: string;
  try {
    url = apiReadinessUrl(apiUrl);
  } catch {
    return 'not-configured';
  }

  try {
    const response = await fetch(url, {
      // The API answers 503 while Postgres is down; that is a readiness answer,
      // not an error, so redirects and caches are what have to be ruled out.
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return response.ok ? null : 'not-ready';
  } catch (error) {
    // `fetch` rejects for both a timeout and a refused connection, and the two
    // mean different things to whoever is looking. Nothing else about the
    // error — message, cause, stack — is read or forwarded.
    return error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable';
  }
}
