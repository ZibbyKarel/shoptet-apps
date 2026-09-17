/**
 * `@garage/auth/client` — the browser-side surface of the auth wrapper.
 *
 * A second entry point rather than a second lib, exactly like
 * `@garage/contract/realtime`: same package, same owner of `next-auth`, but
 * a module graph that stops before Auth.js's server runtime. A client
 * component that imports from here pulls in `next-auth/react` and nothing else.
 *
 * `AuthSession` and `REFRESH_TOKEN_ERROR` are re-exported so a component never
 * has to reach across to the server entry point just to name a type.
 */

export { AuthProvider, SESSION_REFETCH_SECONDS } from '../lib/client';
export type { AuthProviderProps, AuthStatus, RequireAuthResult } from '../lib/client';
export { signIn, signOut, useAccessTokenProvider, useRequireAuth, useSession } from '../lib/client';

export { OKTA_PROVIDER_ID, REFRESH_TOKEN_ERROR } from '../lib/session';
export type { AuthSession, RefreshTokenError } from '../lib/session';
