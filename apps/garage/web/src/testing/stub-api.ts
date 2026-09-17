/**
 * Test-only helpers that put a **real** `ApiClient` behind a stubbed `fetch`.
 *
 * The tests that use this are about how TanStack Query reacts to what the API
 * actually returns — whether a 423 is retried, whether a domain code survives
 * into a component. A hand-written fake client would answer none of that,
 * because it would skip the transport that produces those errors in the first
 * place. So the only thing replaced here is the bottom-most `fetch`.
 */

import { createApiClient } from '@garage/api-client';
import type { ApiClient, ApiFetch } from '@garage/api-client';
import { ERROR_DEFINITIONS } from '@garage/contract';
import type { ErrorCode } from '@garage/contract';

export interface StubbedResponse {
  status: number;
  body: unknown;
}

export interface StubbedApi {
  client: ApiClient;
  /** Every request that reached the transport, in order. */
  requests: Request[];
}

const URL_BASE = 'https://api.test/rpc';

/** oRPC's RPC envelope. A payload outside it deserialises to `undefined`. */
export function rpcPayload(value: unknown): { json: unknown; meta: [] } {
  return { json: value, meta: [] };
}

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
  const requests: Request[] = [];

  const fetch: ApiFetch = async (request) => {
    const callIndex = requests.length;
    requests.push(request.clone());
    const { status, body } = respond(callIndex);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };

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
