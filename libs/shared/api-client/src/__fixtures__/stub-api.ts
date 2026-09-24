/**
 * Test-only helpers that put a **real** `ApiClient` behind a stubbed `fetch`.
 *
 * These tests are about how TanStack Query reacts to what the API actually
 * returns — whether a 423 is retried, whether a domain code survives into a
 * component. A hand-written fake client would answer none of that, because it
 * would skip the transport that produces those errors in the first place. So
 * the only thing replaced here is the bottom-most `fetch`.
 *
 * Lives in `__fixtures__/` because `tsconfig.lib.json` excludes that folder;
 * being unreferenced by `src/index.ts` is not enough to keep a file out of the
 * library's compilation program (see `libs/garage/contract/src/__fixtures__`). A
 * sibling of `stub-transport.ts`, not a replacement for it: that one is used by
 * `api-client.spec.ts`/`errors.spec.ts` to test the transport itself, this one
 * additionally wraps `createApiClient` for `api-query.spec.ts`'s key tests.
 */

import { createApiClient } from '../lib/api-client';
import type { ApiClient, ApiFetch } from '../lib/api-client';
import { ERROR_DEFINITIONS } from '@garage/contract';
import type { ErrorCode } from '@garage/contract';
import { rpcPayload, stubTransport, type StubbedResponse } from './stub-transport';

export type { StubbedResponse };

export interface StubbedApi {
  client: ApiClient;
  /** Every request that reached the transport, in order. */
  requests: Request[];
}

const URL_BASE = 'https://api.test/rpc';

/**
 * The response `apps/garage/api` produces for a domain error, wrapped in the RPC
 * envelope the client reads it out of (`doc/decision/0018-*`, `0033-*`).
 */
export function contractErrorResponse(
  code: ErrorCode,
  data?: Record<string, unknown>
): StubbedResponse {
  const definition = ERROR_DEFINITIONS[code];
  return {
    status: definition.status,
    body: rpcPayload({
      defined: false,
      code,
      status: definition.status,
      message: definition.message,
      ...(data === undefined ? {} : { data }),
    }),
  };
}

/** Nest's shape for a failure that is not a domain error. */
export function transportErrorResponse(status: number, message: string): StubbedResponse {
  return { status, body: { statusCode: status, message } };
}

export function stubApi(respond: (callIndex: number) => StubbedResponse): StubbedApi {
  const { requests, fetch } = stubTransport(respond);

  return { client: createApiClient({ url: URL_BASE, fetch }), requests };
}

/** An API whose every request fails before reaching a server. */
export function unreachableApi(): StubbedApi {
  const requests: Request[] = [];

  const fetch: ApiFetch = async (request) => {
    requests.push(request.clone());
    throw new TypeError('Failed to fetch');
  };

  return { client: createApiClient({ url: URL_BASE, fetch }), requests };
}
