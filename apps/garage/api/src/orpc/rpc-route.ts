/**
 * Where the contract's procedures live on the wire.
 *
 * `libs/shared/api-client` drives an `RPCLink` whose base URL ends in `/rpc`, and oRPC's
 * RPC protocol appends the procedure's **key path** in the contract router
 * (`libs/shared/api-client/src/lib/api-client.spec.ts` pins
 * `POST /rpc/admin/spot/list`). So the routing table is not a decision this app
 * gets to make: it is the shape of `contract` in `libs/garage/contract`, and the
 * helpers here exist so a controller states a path in exactly those terms
 * instead of typing a URL.
 *
 * `orpc-route-parity.spec.ts` walks the contract and the registered Nest routes
 * and fails if the two sets drift.
 */

import { GLOBAL_PREFIX } from '../configure-app';

/** Path segment under the global prefix that carries the RPC transport. */
export const RPC_ROUTE_PREFIX = 'rpc';

/**
 * The prefix oRPC's handler strips before matching, i.e. everything in front of
 * the procedure's key path. It includes {@link GLOBAL_PREFIX} because Nest
 * prepends that to the route and the request URL the handler reads is the full
 * one.
 */
export const RPC_PATH_PREFIX = `/${GLOBAL_PREFIX}/${RPC_ROUTE_PREFIX}`;

/**
 * The route path of one procedure, **relative to the controller prefix**
 * ({@link RPC_ROUTE_PREFIX}).
 *
 * ```ts
 * ‍@Post(rpcRoute('admin', 'spot', 'list'))   // -> 'admin/spot/list'
 * ```
 */
export function rpcRoute(...segments: readonly string[]): string {
  if (segments.length === 0) {
    throw new Error('An RPC route needs at least one segment.');
  }
  return segments.join('/');
}
