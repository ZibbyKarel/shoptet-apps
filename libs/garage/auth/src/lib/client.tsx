/**
 * The browser half of the wrapper: the session provider and the hooks feature
 * code uses.
 *
 * Reached as `@garage/auth/client`, separate from the server entry point on
 * purpose. `@garage/auth` pulls in `next-auth`'s server runtime (route
 * handlers, `next/server`), which has no business in a browser bundle; keeping
 * the two apart means a client component importing this file gets only what it
 * can actually run — the same split `libs/garage/contract` makes between its API and
 * realtime entry points.
 *
 * Like `QueryProvider` in `libs/query` and `IntlProvider` in `libs/shared/i18n`, this
 * file carries **no** `'use client'` directive: the app marks its own provider
 * boundary as a client component and composes all three there.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { SessionProvider, signIn, signOut, useSession } from 'next-auth/react';
import type { AccessTokenProvider } from '@garage/api-client';
import { accessTokenOf } from './access-token';
import { OKTA_PROVIDER_ID, REFRESH_TOKEN_ERROR } from './session';
import type { AuthSession } from './session';

/**
 * How often the browser re-reads `/api/auth/session`, in seconds.
 *
 * This is what makes refresh token rotation actually happen in an idle tab.
 * The rotation lives in the server-side `jwt` callback, and that callback only
 * runs when something asks for the session — so with Auth.js's default of `0`
 * (no polling) a tab left open would keep an access token until it expired,
 * and the Socket.io connection holding it would be dropped by the API rather
 * than renewed. Five minutes is comfortably inside the one-minute renewal skew
 * for any realistic Okta token lifetime, and is one request per tab per five
 * minutes.
 */
export const SESSION_REFETCH_SECONDS = 300;

export interface AuthProviderProps {
  readonly children: ReactNode;
  /**
   * The session read on the server, handed down so the first client render
   * matches the server one instead of flashing "loading". `apps/garage/web` passes
   * `await auth()` from its root layout.
   *
   * `null` and *absent* are different, and the difference is load-bearing:
   * `null` states "there is no session, I checked", while omitting the prop
   * tells Auth.js to start in `loading` and go and fetch one. Passing `null`
   * for "I don't know" would render every visitor as signed-out for a frame
   * and send them straight to Okta.
   */
  readonly session?: AuthSession | null;
  /** Override {@link SESSION_REFETCH_SECONDS}. `0` disables polling. */
  readonly refetchIntervalSeconds?: number;
}

/**
 * The single place components attach to Auth.js's session context.
 *
 * There is no token prop and no token state here: the provider holds whatever
 * `/api/auth/session` returned, in React state, for as long as the page lives.
 */
export function AuthProvider({
  children,
  session,
  refetchIntervalSeconds = SESSION_REFETCH_SECONDS,
}: AuthProviderProps) {
  // Spread rather than assigned: `exactOptionalPropertyTypes` makes
  // `session: undefined` a different type from an absent `session`, and
  // Auth.js reads exactly that distinction (`props.session !== undefined`).
  const initialSession = session === undefined ? {} : { session };

  return (
    <SessionProvider {...initialSession} refetchInterval={refetchIntervalSeconds}>
      {children}
    </SessionProvider>
  );
}

/** What the current session looks like to a component. */
export type AuthStatus = 'authenticated' | 'loading' | 'unauthenticated';

export interface RequireAuthResult {
  readonly session: AuthSession | null;
  readonly status: AuthStatus;
}

/**
 * Requires a signed-in user for the subtree that calls it.
 *
 * Two things send the user away, and neither of them is a silent 401:
 *
 * - **no session** — straight back to Okta via `signIn`. Middleware already
 *   catches this on navigation; this hook is what catches a session that ends
 *   while the tab is open.
 * - **a failed refresh** (`session.error === 'RefreshTokenError'`) — `signOut`,
 *   which clears the dead session cookie before anything else can be attempted
 *   with it. Signing *in* while a broken session is still stored is how you get
 *   a redirect loop.
 *
 * Both are fired once per mount: the redirect navigates away, and a second
 * call while that is in flight would race the first.
 */
export function useRequireAuth(): RequireAuthResult {
  const { data: session, status } = useSession();
  const redirected = useRef(false);
  const error = session?.error;

  useEffect(() => {
    if (status === 'loading' || redirected.current) return;

    if (error === REFRESH_TOKEN_ERROR) {
      redirected.current = true;
      void signOut();
      return;
    }

    if (status === 'unauthenticated') {
      redirected.current = true;
      void signIn(OKTA_PROVIDER_ID);
    }
  }, [status, error]);

  return { session: session ?? null, status };
}

/**
 * The access token of the current session, as the provider
 * `createApiClient({ getAccessToken })` and the realtime client expect.
 *
 * The returned function is referentially stable for the life of the component,
 * so a client or a socket built from it is not torn down and rebuilt every
 * time the session is re-fetched — yet it always reads the *latest* session,
 * because it goes through a ref rather than closing over one render's value.
 * That combination is the whole reason `libs/shared/api-client` takes a function
 * instead of a string.
 */
export function useAccessTokenProvider(): AccessTokenProvider {
  const { data: session } = useSession();
  const sessionRef = useRef<AuthSession | null>(session ?? null);

  // Written during render on purpose: the value is never read while rendering,
  // only from the callback below, and an effect would leave the callback one
  // commit behind — long enough for a socket connecting in a sibling effect to
  // pick up the previous token.
  sessionRef.current = session ?? null;

  return useCallback(async () => accessTokenOf(sessionRef.current), []);
}

/**
 * Auth.js's own client helpers, re-exported so a component never needs a
 * second, direct import of `next-auth/react`.
 *
 * `useSession` is the read side (`{ data, status, update }`); `signIn` /
 * `signOut` are for an explicit button, where `useRequireAuth` handles the
 * automatic cases.
 */
export { signIn, signOut, useSession };
