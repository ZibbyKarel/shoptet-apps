/**
 * The session and JWT shapes this wrapper adds on top of Auth.js's defaults.
 *
 * Auth.js's `Session` and `JWT` are declared as open interfaces precisely so
 * that an application can widen them; this file is the one place in the
 * workspace that does. Importing anything from `@garage/auth` pulls this
 * module in, so the widened types are visible wherever the wrapper is used and
 * nowhere else has to redeclare them.
 *
 * Naming is camelCase (`accessToken`, not `access_token`): these are *our*
 * fields on *our* session, not the OAuth2 wire format. The snake_case names in
 * the Auth.js guides are just what their examples happened to pick.
 */

// Imported for the side effect of resolving the modules being augmented — a
// `declare module` block for a package that was never loaded is a *new*
// ambient module declaration, not an augmentation of the existing one, and it
// would silently shadow the real types instead of extending them.
import type {} from 'next-auth';
import type {} from 'next-auth/jwt';
import type { Session } from 'next-auth';

/**
 * The single failure mode this wrapper reports to the UI: the access token had
 * expired (or was about to) and could not be renewed with the refresh token.
 *
 * It is one closed constant rather than a free-form message because the client
 * switches on it — see `useRequireAuth`, which signs the user out when it
 * appears. Anything more granular would be describing the identity provider's
 * internals to a user who can only do one thing about it.
 */
export const REFRESH_TOKEN_ERROR = 'RefreshTokenError';

/** The type of {@link REFRESH_TOKEN_ERROR}. */
export type RefreshTokenError = typeof REFRESH_TOKEN_ERROR;

/**
 * The Auth.js provider id for Okta.
 *
 * It lives in this dependency-free module because both halves of the wrapper
 * need it — the server config registers the provider under it, and the browser
 * hook passes it to `signIn` — and neither half may import the other's module
 * graph. It is also what fixes the OAuth2 callback URL that has to be
 * registered with Okta: `/api/auth/callback/okta`.
 */
export const OKTA_PROVIDER_ID = 'okta';

declare module 'next-auth' {
  interface Session {
    /**
     * The Okta access token the API expects as a bearer.
     *
     * Optional, and deliberately absent rather than stale when
     * {@link Session.error} is set: a request with no `Authorization` header
     * fails as unauthenticated, whereas one carrying an expired token fails
     * with an error the user cannot distinguish from a bug.
     */
    accessToken?: string;
    /** Set when the last refresh attempt failed. See {@link REFRESH_TOKEN_ERROR}. */
    error?: RefreshTokenError;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    /** Current Okta access token. Renewed in place by the `jwt` callback. */
    accessToken?: string;
    /** Unix seconds at which {@link JWT.accessToken} expires. */
    expiresAt?: number;
    /**
     * Okta refresh token. Never leaves the server: it is stored in the
     * encrypted, httpOnly Auth.js session cookie and is not copied onto the
     * `Session` the browser can read.
     */
    refreshToken?: string;
    /** Set when the last refresh attempt failed. See {@link REFRESH_TOKEN_ERROR}. */
    error?: RefreshTokenError;
  }
}

/**
 * The application-facing session type.
 *
 * Re-exported under our own name so feature code never has to name `next-auth`
 * to annotate a variable — which is the whole point of a wrapper lib.
 */
export type AuthSession = Session;

/**
 * Reads the current session. On the server this is Auth.js's `auth()`; in a
 * browser it is backed by whatever `useSession()` last received.
 *
 * Taking it as a parameter (rather than reaching for `auth()` directly) is what
 * lets {@link createAccessTokenProvider} be exercised without a request.
 */
export type SessionReader = () => Promise<AuthSession | null>;
