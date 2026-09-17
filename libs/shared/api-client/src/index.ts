/**
 * `@garage/api-client` — the wrapper lib that owns `@orpc/client`.
 *
 * Three things come out of here and nothing else needs to:
 *
 * - {@link createApiClient} / {@link ApiClient} — the transport, typed from
 *   `libs/garage/contract`;
 * - {@link toContractError} / {@link errorStatus} — reading a failure back as a
 *   member of the contract's closed error enum;
 * - {@link createApiQueryUtils} / {@link ApiQueryUtils} — the bridge from this
 *   client to TanStack Query's query/mutation options, contract-derived so no
 *   caller ever hand-writes a query key. `@tanstack/react-query` itself is not
 *   wrapped (`doc/decision/0308-*`) — this only re-exports the part that is
 *   specific to *this* client, built on `@orpc/tanstack-query`.
 *
 * See `doc/wrappers.md` for why the direct `@orpc/client` import is banned
 * everywhere else.
 */
export type { AccessTokenProvider, ApiClient, ApiClientOptions, ApiFetch } from './lib/api-client';
export { createApiClient } from './lib/api-client';
export type { ContractError } from './lib/errors';
export { errorStatus, toContractError } from './lib/errors';
export type { ApiQueryUtils } from './lib/api-query';
export { createApiQueryUtils } from './lib/api-query';
