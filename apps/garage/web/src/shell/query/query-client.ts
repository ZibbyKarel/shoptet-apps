/**
 * The one `QueryClient` configuration the app runs on.
 *
 * `@tanstack/react-query` is no longer a wrapped library (`doc/decision/0308-*`
 * — it used to be, via `libs/query`), so this file is not the only place that
 * *could* import it, but it stays the one place that sets these defaults —
 * caching and retry behaviour is a product decision, not something each
 * feature re-derives at its own call site.
 *
 * ## The cache is per-user only because the *client* is, not because the keys are
 *
 * Query keys here are `[path, { type, input }]` (`@orpc/tanstack-query`,
 * `@garage/api-client`'s `api-query.ts`) and carry **no user identity**. Two
 * people's `overview.day` for the same date are the same key. Nothing in this
 * module can notice an identity change, and there is no `queryClient.clear()`
 * on one — so the isolation rests entirely on two facts outside it, both
 * currently true:
 *
 * - **sign-out is a full navigation.** `apps/garage/web/src/shell/app-top-bar.tsx`
 *   calls `signOut({ redirectTo: LOGIN_ROUTE })`, which unloads the document
 *   and destroys the client with it.
 * - **the client is built per mount, not at module scope.**
 *   `apps/garage/web/src/app/providers.tsx` uses `useState(() => createQueryClient())`,
 *   so it is one client per browser session and — because Next.js renders this
 *   on the server too — one per request there, rather than a singleton shared
 *   across users. {@link createQueryClient} is a factory, kept that way on
 *   purpose so a module-level `new QueryClient()` singleton is never tempting
 *   to write here.
 *
 * **If an in-place account switch is ever added** — a "switch user" control, a
 * silent re-auth to a different subject, anything that changes the session
 * without unloading the document — this becomes a quiet cross-user read: the
 * new user is served the old user's cached day, with no error and nothing in a
 * log. The fix at that point is to clear or re-key the cache on the identity
 * change, and it has to be made here rather than at a call site.
 */

import { QueryClient } from '@tanstack/react-query';
import type { DefaultOptions, QueryClientConfig } from '@tanstack/react-query';
import { shouldRetryQuery } from './retry';

/**
 * How long a fetched result is served without a refetch.
 *
 * Reservation data changes when *someone else* books a spot, and that arrives
 * over Socket.io (`libs/garage/realtime-client`) rather than by polling — so this is
 * about avoiding a refetch storm when a user moves between screens, not about
 * freshness.
 */
export const DEFAULT_STALE_TIME_MS = 30_000;

/** How long an unused result stays in the cache before it is dropped. */
export const DEFAULT_GC_TIME_MS = 5 * 60_000;

export const DEFAULT_QUERY_OPTIONS = {
  staleTime: DEFAULT_STALE_TIME_MS,
  gcTime: DEFAULT_GC_TIME_MS,
  /**
   * Off: with realtime invalidation in place, refetching every screen each time
   * the tab regains focus is redundant traffic. TanStack's default is `true`.
   */
  refetchOnWindowFocus: false,
  retry: shouldRetryQuery,
} satisfies DefaultOptions['queries'];

/**
 * Mutations are **not** retried, which is also TanStack's default and is
 * restated here so it reads as a decision rather than an omission.
 *
 * Every mutation in this contract writes something a person did on purpose —
 * booking, cancelling, joining a queue. A silent second attempt after an
 * ambiguous failure risks a duplicate write the user never asked for, and the
 * unique constraints that make double-booking impossible would turn the retry
 * into a *different* error than the original.
 */
export const DEFAULT_MUTATION_OPTIONS = {
  retry: false,
} satisfies DefaultOptions['mutations'];

/**
 * Builds the app's `QueryClient`.
 *
 * `overrides` is merged one level deep into `defaultOptions`, so a caller (in
 * practice: a test that wants `retryDelay: () => 0`) can change one option
 * without silently dropping the rest of the defaults — which is what passing a
 * whole `defaultOptions` object to `new QueryClient` would do.
 */
export function createQueryClient(overrides: QueryClientConfig = {}): QueryClient {
  const { defaultOptions, ...rest } = overrides;
  const { queries, mutations, ...otherDefaults } = defaultOptions ?? {};

  return new QueryClient({
    ...rest,
    defaultOptions: {
      ...otherDefaults,
      queries: { ...DEFAULT_QUERY_OPTIONS, ...queries },
      mutations: { ...DEFAULT_MUTATION_OPTIONS, ...mutations },
    },
  });
}
