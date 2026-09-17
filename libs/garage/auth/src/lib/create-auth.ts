/**
 * The one call that instantiates Auth.js, and the only file in the workspace
 * that names the `next-auth` default export.
 *
 * `apps/garage/web` (Task 23) does:
 *
 * ```ts
 * // apps/garage/web/src/auth.ts
 * export const { handlers, auth, signIn, signOut, getAccessToken } = createAuth({
 *   issuer: env.AUTH_OKTA_ISSUER,
 *   clientId: env.AUTH_OKTA_CLIENT_ID,
 *   clientSecret: env.AUTH_OKTA_CLIENT_SECRET,
 *   secret: env.AUTH_SECRET,
 * });
 * ```
 *
 * …then `export const { GET, POST } = handlers` from
 * `app/api/auth/[...nextauth]/route.ts` and `export { auth as middleware }`
 * from `middleware.ts`. Every value comes from the schema in
 * `apps/garage/web/src/env.ts`; this lib reads no environment variable of its own, so
 * there is no path by which a secret can be picked up implicitly or shipped
 * with a default.
 */

import NextAuth from 'next-auth';
import type { NextAuthResult } from 'next-auth';
import { createAuthConfig } from './config';
import type { AuthOptions } from './config';
import { createAccessTokenProvider } from './access-token';
import type { AccessTokenProvider } from '@garage/api-client';

export interface Auth {
  /**
   * Route handlers for `app/api/auth/[...nextauth]/route.ts`. These serve the
   * OAuth2 callback and the `/api/auth/session` endpoint the browser reads.
   */
  readonly handlers: NextAuthResult['handlers'];
  /**
   * Auth.js's universal `auth()`. Called with no arguments in a Server
   * Component, Route Handler or Server Action it returns the current session;
   * exported from `middleware.ts` it becomes the middleware that enforces the
   * `authorized` callback.
   */
  readonly auth: NextAuthResult['auth'];
  /** Server-side sign-in (Server Action / Route Handler). */
  readonly signIn: NextAuthResult['signIn'];
  /** Server-side sign-out (Server Action / Route Handler). */
  readonly signOut: NextAuthResult['signOut'];
  /**
   * The access token of the current request's session, for
   * `createApiClient({ getAccessToken })` on the server. Returns `null` when
   * there is no session or the refresh failed — never a stale token.
   */
  readonly getAccessToken: AccessTokenProvider;
}

/** Instantiates Auth.js for this application. */
export function createAuth(options: AuthOptions): Auth {
  const { handlers, auth, signIn, signOut } = NextAuth(createAuthConfig(options));

  return {
    handlers,
    auth,
    signIn,
    signOut,
    getAccessToken: createAccessTokenProvider(() => auth()),
  };
}
