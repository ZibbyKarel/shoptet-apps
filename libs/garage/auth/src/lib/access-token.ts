/**
 * The seam between the session and the transports.
 *
 * `libs/shared/api-client` was built (Task 19) around an injectable
 * `AccessTokenProvider` — a function read once **per request** rather than a
 * string captured at construction — precisely so that this lib could supply it
 * without either lib importing the other's third-party package.
 * `libs/garage/realtime-client` (Task 21) takes the same function for its Socket.io
 * handshake.
 *
 * Nothing here touches `localStorage`, `sessionStorage`, a cookie written from
 * JavaScript, or a module-level variable. The token is read from the session
 * every time it is needed: on the server that is the encrypted httpOnly cookie
 * Auth.js decrypts, in the browser it is the value `useSession()` currently
 * holds in React state. Persisting it anywhere would outlive both the session
 * and the tab.
 */

import type { AccessTokenProvider } from '@garage/api-client';
import { REFRESH_TOKEN_ERROR } from './session';
import type { AuthSession, SessionReader } from './session';

/**
 * Reads the access token out of one session, or `null` if there is nothing
 * usable to send.
 *
 * `null` — rather than a stale token — whenever the refresh failed. An absent
 * `Authorization` header makes the API answer "unauthenticated", which the UI
 * already handles by sending the user back to Okta; a header carrying a dead
 * token produces a 401 that is indistinguishable from a bug.
 */
export function accessTokenOf(session: AuthSession | null | undefined): string | null {
  if (!session || session.error === REFRESH_TOKEN_ERROR) return null;
  return session.accessToken ?? null;
}

/**
 * Adapts a session reader into the provider `createApiClient` and the realtime
 * client expect.
 *
 * Taking the reader as an argument is what makes this testable and what makes
 * it work identically on both sides: `createAuth()` passes Auth.js's `auth()`,
 * the browser hook passes a function closing over the current session.
 */
export function createAccessTokenProvider(getSession: SessionReader): AccessTokenProvider {
  return async () => accessTokenOf(await getSession());
}
