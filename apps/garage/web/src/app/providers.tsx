'use client';

/**
 * The application's single client boundary.
 *
 * Every wrapper lib deliberately ships its provider **without** a `'use
 * client'` directive of its own — `QueryProvider`, `AuthProvider`,
 * `IntlProvider` and `RealtimeProvider` all say so in their own file headers —
 * so that the app marks the boundary once, here, and composes them in one
 * place. This is that place.
 *
 * The nesting order is not arbitrary:
 *
 * 1. `AuthProvider` outermost, because everything below reads the session:
 *    the API client takes its bearer token from it and the socket takes its
 *    handshake token from it.
 * 2. `IntlProvider` next, so that a failure rendered by any screen already has
 *    translated copy available. Its locale and catalog are resolved on the
 *    server (`layout.tsx`) and passed in — this component chooses neither.
 * 3. `QueryClientProvider`, then `ApiProvider` — the client is built from the
 *    token provider, so it has to be inside `AuthProvider`, and the query
 *    utilities are built from the client.
 * 4. `RealtimeBoundary` innermost: it is the only one that needs both a
 *    session *status* and a token, and it holds the socket closed until there
 *    is one.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { AuthProvider } from '@garage/auth/client';
import type { AuthSession } from '@garage/auth/client';
import { IntlProvider } from '@garage/i18n';
import type { AppMessages, Locale } from '@garage/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../shell/query/query-client';
import { ApiProvider } from '../shell/api-provider/api-provider';
import { RealtimeBoundary } from '../shell/realtime-boundary/realtime-boundary';

export interface ProvidersProps {
  /**
   * The session read on the server. `null` states "there is no session, I
   * checked"; omitting it would tell Auth.js to start in `loading` and render
   * every visitor as signed-out for a frame.
   */
  readonly session: AuthSession | null;
  /** `NEXT_PUBLIC_API_URL` — the oRPC endpoint, `/api` prefix included. */
  readonly apiUrl: string;
  /** Origin of the same deployment, for Socket.io. See `../api-url.ts`. */
  readonly socketUrl: string;
  /** Resolved on the server for this request. See `../i18n/resolve-locale.ts`. */
  readonly locale: Locale;
  /** The catalog for `locale`. See `../i18n/load-messages.ts`. */
  readonly messages: AppMessages;
  readonly children: ReactNode;
}

export function Providers({
  session,
  apiUrl,
  socketUrl,
  locale,
  messages,
  children,
}: ProvidersProps) {
  // A client created in the render body would be thrown away on every render,
  // taking the cache with it. `useState`'s initialiser runs once per mount,
  // which for the root boundary means once per browser session — and once per
  // request on the server, which is what SSR needs.
  //
  // `createQueryClient` rather than `new QueryClient`: the retry and caching
  // policy is a product decision (`apps/garage/web/src/shell/query/query-client.ts`),
  // not something a call site should re-derive.
  const [queryClient] = useState(() => createQueryClient());

  return (
    <AuthProvider session={session}>
      <IntlProvider locale={locale} messages={messages}>
        <QueryClientProvider client={queryClient}>
          <ApiProvider url={apiUrl}>
            <RealtimeBoundary url={socketUrl}>{children}</RealtimeBoundary>
          </ApiProvider>
        </QueryClientProvider>
      </IntlProvider>
    </AuthProvider>
  );
}
