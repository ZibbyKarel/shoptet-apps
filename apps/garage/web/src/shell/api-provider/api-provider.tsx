'use client';

/**
 * The browser's oRPC client, and the TanStack Query utilities derived from it.
 *
 * One client per browser session, built from the session's access token, is
 * what every screen reads the API through. Two things about the wiring are
 * load-bearing:
 *
 * - the token comes from `useAccessTokenProvider()`, whose returned function is
 *   referentially stable yet always reads the *latest* session. That is why the
 *   client can be memoised for the life of the page without pinning an expired
 *   token to it (`doc/auth.md`, §"Using it from the app").
 * - nothing here names `@orpc/client` directly. The transport and the
 *   contract-derived query utilities both come from `@garage/api-client` —
 *   the wrapper rule for `@orpc/client`, enforced by `no-restricted-imports`
 *   in `eslint.config.mjs`. `@tanstack/react-query` itself is not wrapped
 *   (`doc/decision/0308-*`).
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useAccessTokenProvider } from '@garage/auth/client';
import { createApiClient, createApiQueryUtils } from '@garage/api-client';
import type { ApiQueryUtils } from '@garage/api-client';
import { apiRpcUrl } from '../../api-url';

const ApiContext = createContext<ApiQueryUtils | null>(null);

export interface ApiProviderProps {
  /**
   * `NEXT_PUBLIC_API_URL` — the API's base URL, `/api` prefix included.
   *
   * Passed through {@link apiRpcUrl} rather than to `createApiClient`
   * directly: the RPC transport is mounted a segment below the base, and
   * skipping that segment 404s every request. See `api-url.ts`.
   */
  readonly url: string;
  readonly children: ReactNode;
}

export function ApiProvider({ url, children }: ApiProviderProps) {
  const getAccessToken = useAccessTokenProvider();

  const utils = useMemo(
    () => createApiQueryUtils(createApiClient({ url: apiRpcUrl(url), getAccessToken })),
    [url, getAccessToken]
  );

  return <ApiContext.Provider value={utils}>{children}</ApiContext.Provider>;
}

/**
 * The contract-derived query keys and query functions for every procedure.
 *
 * Throws rather than returning `null` outside a provider: a screen that
 * silently fetched nothing would show up as "the data never loads" in
 * production instead of as a crash in development.
 */
export function useApi(): ApiQueryUtils {
  const utils = useContext(ApiContext);
  if (utils === null) {
    throw new Error('useApi must be used inside an <ApiProvider>.');
  }
  return utils;
}
