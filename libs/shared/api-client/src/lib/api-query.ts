/**
 * The bridge between the contract-typed oRPC client and TanStack Query.
 *
 * `createApiQueryUtils(client)` mirrors the contract's router shape, so
 * `utils.overview.day.queryOptions({ input: { date } })` produces the query key
 * *and* the query function for that procedure, both derived from the contract.
 * Feature code therefore never hand-writes a query key — which is what keeps
 * "invalidate everything about the day overview" from silently missing a cache
 * entry whose key someone spelled differently.
 *
 * `@orpc/tanstack-query` is not itself a wrapped library: nothing could be
 * imported *instead* of it, it only exists to pair the two packages this
 * workspace already wraps one of (`@orpc/client`, here) and no longer wraps the
 * other of (`@tanstack/react-query`, since `doc/decision/0308-*`). It is
 * allow-listed for `type:util` next to `@hookform/resolvers`, for the same
 * reason (`eslint.config.mjs`).
 */

import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { RouterUtils } from '@orpc/tanstack-query';
import type { ApiClient } from './api-client';

/**
 * The contract's router, as query/mutation utilities.
 *
 * Every leaf carries `queryKey`, `queryOptions`, `mutationKey`,
 * `mutationOptions` and `call`; every branch carries `key()` for partial
 * matching (invalidation). All of it is derived from `ApiClient`, i.e. from
 * `libs/garage/contract`.
 */
export type ApiQueryUtils = RouterUtils<ApiClient>;

export function createApiQueryUtils(client: ApiClient): ApiQueryUtils {
  return createTanstackQueryUtils(client);
}
