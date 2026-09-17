/**
 * The oRPC client, typed from `libs/garage/contract` and nothing else.
 *
 * This is the only place in the workspace allowed to import `@orpc/client`
 * (`eslint.config.mjs`, `WRAPPED_LIBRARIES`; `doc/wrappers.md`). Everything else
 * — feature code, `libs/query` — reaches the API through `ApiClient`, whose
 * every procedure, input, output and error code is derived from the contract.
 * No endpoint can be called that the contract does not declare, and no shape
 * can be hand-written next to it.
 */

import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RPCLinkOptions } from '@orpc/client/fetch';
import type { ContractClient } from '@garage/contract';

/**
 * The client's per-call context. Empty: every request carries the same bearer
 * token, resolved by {@link ApiClientOptions.getAccessToken}, so there is
 * nothing a call site needs to pass down. Named rather than inlined because
 * `RPCLink` and `createORPCClient` have to agree on it, and it must match the
 * default `ContractClient` was applied with in `libs/garage/contract`.
 */
type ApiClientContext = Record<never, never>;

/**
 * Every procedure in `libs/garage/contract`'s router, as a callable client.
 *
 * The `ContractRouterClient<Contract>` application lives in `libs/garage/contract`
 * (exported as `ContractClient`) rather than here, so that `@orpc/contract`
 * stays allow-listed for the `type:contract` tag alone instead of every
 * `type:util` lib in the workspace. Either way the type is derived from the Zod
 * schemas on every build and cannot drift from the backend.
 */
export type ApiClient = ContractClient;

/**
 * The `fetch` implementation the link uses. Exported so a caller (and this
 * lib's own tests) can supply one without reaching for `@orpc/client`.
 */
export type ApiFetch = NonNullable<RPCLinkOptions<ApiClientContext>['fetch']>;

/**
 * Supplies the access token for the `Authorization` header.
 *
 * `libs/garage/auth` (Task 20) provides the real implementation; until then any caller
 * can inject one. It is a function rather than a string because the token is
 * refreshed independently of the client — reading it per request is what keeps
 * a long-lived client from pinning an expired token.
 *
 * Returning `null`/`undefined` means "no session": the header is then omitted
 * entirely rather than sent as `Bearer undefined`.
 */
export type AccessTokenProvider = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

export interface ApiClientOptions {
  /** Base URL of the oRPC endpoint, e.g. `https://example.test/rpc`. */
  url: string | URL;
  /** Where the bearer token comes from. Omit for unauthenticated calls. */
  getAccessToken?: AccessTokenProvider;
  /** Override the `fetch` used for the request. Mainly for tests and SSR. */
  fetch?: ApiFetch;
}

/**
 * Builds a client for the whole contract.
 *
 * The headers callback runs **per request**, so a token that arrives (or
 * expires) after the client was constructed is still picked up.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const { url, getAccessToken, fetch } = options;

  const link = new RPCLink<ApiClientContext>({
    url,
    headers: async () => {
      const token = await getAccessToken?.();
      return token == null || token === '' ? {} : { authorization: `Bearer ${token}` };
    },
    // Spread rather than assigned: `exactOptionalPropertyTypes` makes
    // `fetch: undefined` a different type from an absent `fetch`.
    ...(fetch === undefined ? {} : { fetch }),
  });

  return createORPCClient<ApiClient>(link);
}
