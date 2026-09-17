/**
 * The Auth.js configuration: one Okta OIDC provider plus the three callbacks
 * that make a short-lived access token usable for the life of a session.
 *
 * **No branch on `NODE_ENV`, and no configuration value read from the
 * environment.** Dev, e2e and production build this same object and differ only
 * in the values `apps/garage/web` passes in, which is the rule Task 11 has to hold to
 * on the API side as well.
 *
 * That is narrower than what this docblock used to claim ("a pure function of
 * its arguments — no `process.env`, no module-level state"), and the difference
 * is worth naming rather than tidying away. `createAuthConfig` reaches for two
 * pieces of **process-global** state, because Next.js compiles the proxy, the
 * `/api/auth/*` handlers and the server components into separate bundles and
 * runs this function once per bundle — three times in one `next start`,
 * measured (`doc/decision/0231-*`). Anything that has to be shared by all three
 * cannot live in a closure:
 *
 * - `sharedRevokedStore()` (`revocation.ts`) — the sign-out registry's map. It
 *   also reads `process.env.NEXT_RUNTIME` and **throws** at call time on any
 *   runtime but Node.js, so building a configuration is not infallible.
 * - `sharedRefreshState()` (`refresh.ts`) — the discovery promise and the
 *   in-flight token grant (`doc/decision/0245-*`).
 *
 * Both are passed in explicitly at the call site below rather than reached for
 * inside their modules, so the global state is visible here.
 */

import Okta from 'next-auth/providers/okta';
import type { NextAuthConfig } from 'next-auth';
import type { Account, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { OKTA_PROVIDER_ID, REFRESH_TOKEN_ERROR } from './session';
import { createTokenRefresher, sharedRefreshState, shouldRefresh } from './refresh';
import type { TokenRefresher } from './refresh';
import { createSignOutRegistry, sharedRevokedStore } from './revocation';
import type { SignOutRegistry } from './revocation';

/**
 * OAuth2 scopes requested at sign-in.
 *
 * `offline_access` is the load-bearing one: without it Okta issues no refresh
 * token at all, the `jwt` callback below has nothing to rotate, and the session
 * dies with the first access token. The other three are what the API's JIT
 * provisioning (Task 11) reads the user's identity from.
 */
export const OKTA_SCOPES = 'openid profile email offline_access';

export interface AuthOptions {
  /** `AUTH_OKTA_ISSUER`. Validated in `apps/garage/web/src/env.ts`. */
  readonly issuer: string;
  /** `AUTH_OKTA_CLIENT_ID`. */
  readonly clientId: string;
  /**
   * `AUTH_OKTA_CLIENT_SECRET`. Server-only: it is used for the OAuth2 code
   * exchange and for refresh, both of which run in the Next.js server runtime.
   * Never reference it from a component, and never give it a `NEXT_PUBLIC_`
   * name — that prefix is what puts a value in the browser bundle.
   */
  readonly clientSecret: string;
  /** `AUTH_SECRET`. Encrypts the session cookie. Server-only, same as above. */
  readonly secret: string;
  /**
   * Path of the application's own sign-in page. When omitted, Auth.js serves
   * its built-in one at `/api/auth/signin`. `apps/garage/web` (Task 23) supplies the
   * real route.
   */
  readonly signInPath?: string;
  /**
   * How long a session cookie stays valid, in seconds. Defaults to Auth.js's
   * 30 days. The access token inside it is renewed independently and far more
   * often — see {@link REFRESH_SKEW_SECONDS}.
   */
  readonly sessionMaxAgeSeconds?: number;
  /**
   * Whether to trust the `Host` header of incoming requests. Defaults to
   * `true`, which is the right answer for this deployment and has to be stated
   * rather than inherited.
   *
   * Auth.js refuses to serve `/api/auth/*` at all when this is false —
   * `assertConfig` in `@auth/core` returns `UntrustedHost` and every request
   * comes back 500 with "Host must be trusted". Its default is computed from
   * the environment:
   *
   * ```js
   * config.trustHost ??= !!(AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? CF_PAGES
   *                         ?? NODE_ENV !== 'production')
   * ```
   *
   * This app sets none of the first four and runs `NODE_ENV=production` behind
   * a reverse proxy, so the default would be `false` **in production only** —
   * dev and e2e stay green for free, and nobody could sign in after the first
   * real deploy. Leaving it to `AUTH_TRUST_HOST` would also contradict this
   * lib's own rule that no environment variable is read behind
   * `apps/garage/web/src/env.ts`'s back; `true` is a property of the deployment
   * topology (single instance, one proxy in front), not of an environment.
   */
  readonly trustHost?: boolean;
  /**
   * Override the `fetch` used for OIDC discovery and token refresh. Mirrors
   * `ApiClientOptions.fetch` in `libs/shared/api-client`: a transport seam for tests
   * and SSR, not an authentication switch — nothing it can be set to skips a
   * signature check or invents a session.
   */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Stores the tokens Okta issued at sign-in.
 *
 * Auth.js hands the `account` to the `jwt` callback exactly once, on the
 * request that completes the OAuth2 code exchange; after that only the JWT
 * survives, so anything not copied here is gone for good.
 */
function seedFromAccount(token: JWT, account: Account): JWT {
  const { access_token: accessToken, expires_at: expiresAt, refresh_token: refreshToken } = account;

  if (typeof accessToken !== 'string' || typeof expiresAt !== 'number') {
    // Not a crash: the session simply carries no bearer, every API call comes
    // back unauthenticated, and `useRequireAuth` sends the user back to Okta.
    // Throwing here would surface as an opaque Auth.js `Configuration` error.
    return markRefreshFailed(token);
  }

  // `error` is removed by omission rather than set to `undefined`:
  // `exactOptionalPropertyTypes` is on, so an optional property either holds a
  // value or is not there at all.
  const { error: _error, ...rest } = token;

  return {
    ...rest,
    accessToken,
    expiresAt,
    ...(typeof refreshToken === 'string' && refreshToken !== '' ? { refreshToken } : {}),
  };
}

/**
 * Drops the access token and marks the session as failed.
 *
 * Dropping rather than keeping the expired token is the point: a request with
 * no `Authorization` header is unauthenticated, which the UI already knows how
 * to handle, whereas one carrying a dead token produces a 401 that looks like
 * a bug. The refresh token is dropped too — it is what just failed.
 */
function markRefreshFailed(token: JWT): JWT {
  const {
    accessToken: _accessToken,
    expiresAt: _expiresAt,
    refreshToken: _refreshToken,
    ...rest
  } = token;
  return { ...rest, error: REFRESH_TOKEN_ERROR };
}

/**
 * The `jwt` callback's whole logic, as a plain function of a token, an
 * optional account and a refresher.
 *
 * Split out from the config object so the rotation rules — renew *before*
 * expiry, do not renew a healthy token, fail closed — are testable without an
 * Auth.js instance or an HTTP request.
 */
export async function rotateAccessToken(
  token: JWT,
  account: Account | null | undefined,
  refresh: TokenRefresher
): Promise<JWT> {
  if (account) return seedFromAccount(token, account);

  // A session that already failed to refresh stays failed. Retrying on every
  // request would hammer the token endpoint with a credential we know is dead.
  if (token.error !== undefined) return token;

  if (typeof token.expiresAt !== 'number') return markRefreshFailed(token);
  if (!shouldRefresh(token.expiresAt)) return token;
  if (typeof token.refreshToken !== 'string' || token.refreshToken === '') {
    return markRefreshFailed(token);
  }

  try {
    const renewed = await refresh(token.refreshToken);
    return {
      ...token,
      accessToken: renewed.accessToken,
      expiresAt: renewed.expiresAt,
      refreshToken: renewed.refreshToken,
    };
  } catch {
    // Nothing is logged here on purpose. The only things worth naming are the
    // provider's error code — already lost by the time this catches — and the
    // token, which must never reach a log. The failure is reported through the
    // session instead, where the UI can act on it.
    return markRefreshFailed(token);
  }
}

/**
 * Auth.js's own default session lifetime, in seconds (30 days).
 *
 * Restated here because {@link AuthOptions.sessionMaxAgeSeconds} is optional
 * and the sign-out registry has to know how long a revocation could still
 * matter. Keeping one for less time than a cookie can live would quietly reopen
 * the hole it exists to close.
 */
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The whole of the `jwt` callback: sign-out revocation first, then rotation.
 *
 * Returning `null` is not an error path — `@auth/core`'s session action reads
 * it as "this session is over" and answers by **clearing the session cookie**
 * instead of re-issuing it (`lib/actions/session.js`). That is what makes a
 * cookie which survived the sign-out race self-healing: the next request that
 * carries it is both refused *and* has it deleted.
 *
 * Revocation is checked **before** rotation on purpose: there is no reason to
 * spend a refresh-token round trip on a session that is about to be thrown
 * away.
 *
 * A completed sign-in needs no branch of its own, and that is worth stating
 * because an earlier version of this function had one. `@auth/core` mints a
 * fresh `sub` for every sign-in, so a new session is never the subject that
 * signed out — `isRevoked` is simply false for it, without being told. The
 * branch that existed to "forget" the previous sign-out could not fire in
 * production at all; only a hand-built token reusing the old subject reached it.
 */
export async function applySessionLifecycle(
  token: JWT,
  account: Account | null | undefined,
  refresh: TokenRefresher,
  registry: SignOutRegistry
): Promise<JWT | null> {
  if (registry.isRevoked(token)) return null;

  return rotateAccessToken(token, account, refresh);
}

/**
 * The `session` callback: projects the JWT onto what a browser may see.
 *
 * The refresh token is **not** copied. It stays in the encrypted, httpOnly
 * cookie that only the Next.js server can decrypt, so the long-lived
 * credential never crosses into JavaScript — while the short-lived access
 * token does, because `libs/garage/realtime-client` has to put it in a Socket.io
 * handshake from the browser.
 */
export function projectSession(session: Session, token: JWT): Session {
  // Both fields are rebuilt from the token every time rather than merged on top
  // of whatever the incoming session carried — `exactOptionalPropertyTypes`
  // aside, that is what guarantees a stale `accessToken` cannot survive a
  // failed refresh.
  const { accessToken: _accessToken, error: _error, ...rest } = session;

  if (token.error !== undefined) {
    return { ...rest, error: token.error };
  }
  return {
    ...rest,
    ...(typeof token.accessToken === 'string' ? { accessToken: token.accessToken } : {}),
  };
}

/**
 * The `authorized` callback, used by Next.js middleware.
 *
 * Returning `false` makes Auth.js redirect the request to the sign-in page, so
 * an unauthenticated (or un-refreshable) request never reaches a protected
 * route and never sees a bare 401.
 */
export function isAuthorized(auth: Session | null): boolean {
  return auth?.user != null && auth.error === undefined;
}

/** Builds the full Auth.js configuration. */
export function createAuthConfig(options: AuthOptions): NextAuthConfig {
  // The refresher object is per configuration; the discovery promise and the
  // in-flight grant it coalesces on are shared by the whole process, and have
  // to be — for exactly the reason stated below for the revocation map. Three
  // refreshers with three private in-flight slots do not coalesce anything
  // between the proxy and the layout, and those two read the *same* request
  // cookie: measured at two token grants where `doc/decision/0051-*` promised
  // one. See `sharedRefreshState` and `doc/decision/0245-*`.
  const refresh = createTokenRefresher({
    issuer: options.issuer,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    state: sharedRefreshState(options.issuer, options.clientId),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  // The registry object is per configuration; the revocations it reads are
  // shared by the whole process, and have to be. Next.js builds the proxy, the
  // `/api/auth/*` handlers and the server components as separate bundles, so
  // this function runs three times in one `next start` — measured. A private
  // map per call would mean the sign-out endpoint revoking into a registry that
  // the proxy, which does the actual authorizing, never reads. See
  // `sharedRevokedStore` and `doc/decision/0231-*`.
  const registry = createSignOutRegistry({
    retentionSeconds: options.sessionMaxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS,
    revoked: sharedRevokedStore(),
  });

  return {
    secret: options.secret,
    // Stated, never inherited from the environment. See `AuthOptions.trustHost`
    // for why the inherited default is `false` in production and only there.
    trustHost: options.trustHost ?? true,
    // No adapter and no database: the session lives entirely in the encrypted
    // cookie. `jwt` is Auth.js's default in that case, stated anyway because
    // the callbacks below only make sense under it.
    session: {
      strategy: 'jwt',
      ...(options.sessionMaxAgeSeconds === undefined
        ? {}
        : { maxAge: options.sessionMaxAgeSeconds }),
    },
    ...(options.signInPath === undefined ? {} : { pages: { signIn: options.signInPath } }),
    providers: [
      Okta({
        // Stated rather than left to Auth.js's `AUTH_OKTA_ID`/`AUTH_OKTA_SECRET`
        // environment inference: this project's variables are named
        // `AUTH_OKTA_CLIENT_ID`/`AUTH_OKTA_CLIENT_SECRET` and are validated in
        // one schema (`apps/garage/web/src/env.ts`), so nothing should be read from
        // the environment behind that schema's back.
        id: OKTA_PROVIDER_ID,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        issuer: options.issuer,
        authorization: { params: { scope: OKTA_SCOPES } },
      }),
    ],
    callbacks: {
      jwt: ({ token, account }) => applySessionLifecycle(token, account, refresh, registry),
      session: ({ session, token }) => projectSession(session, token),
      authorized: ({ auth }) => isAuthorized(auth),
    },
    events: {
      /**
       * Records the sign-out **before** Auth.js writes the cookie clear.
       *
       * `@auth/core`'s signout action awaits this event and only then pushes
       * `sessionStore.clean()` (`lib/actions/signout.js`), so by the time the
       * clearing response leaves the server the subject is already revoked —
       * and any render that was racing it is already answering with a token
       * this registry will refuse, since re-encoding never changes `sub`.
       *
       * Under `strategy: 'jwt'` the message carries the decoded `token`; the
       * `session` shape is the database-strategy branch, which this app does
       * not use. Narrowing rather than asserting, because a wrong assumption
       * here would fail silently as "sign-out stopped revoking".
       */
      signOut: (message) => {
        if ('token' in message && message.token != null) registry.revoke(message.token);
      },
    },
  };
}
