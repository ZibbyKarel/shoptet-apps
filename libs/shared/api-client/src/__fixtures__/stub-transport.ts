/**
 * Test-only transport stubs.
 *
 * Every test in this lib drives a **real** `RPCLink` (built by
 * `createApiClient`) and only replaces the `fetch` at the very bottom. That is
 * deliberate: what these tests are about — the URL the link builds, the header
 * it attaches, the wire format it expects an error in — is exactly the part a
 * hand-rolled mock client would skip.
 *
 * Lives in `__fixtures__/` because `tsconfig.lib.json` excludes that folder;
 * being unreferenced by `src/index.ts` is not enough to keep a file out of the
 * library's compilation program (see `libs/garage/contract/src/__fixtures__`).
 */

import type { ApiFetch } from '../lib/api-client';

export interface StubbedResponse {
  status: number;
  /** Parsed body; serialized to JSON by the stub. */
  body: unknown;
}

export interface StubbedTransport {
  /** Every request the link issued, in order. Cloned, so bodies stay readable. */
  requests: Request[];
  fetch: ApiFetch;
}

/**
 * A `fetch` that records requests and answers with canned JSON.
 *
 * `respond` receives the call index, so a test can return a different answer to
 * the first and second attempt — which is what the retry tests need.
 */
export function stubTransport(respond: (callIndex: number) => StubbedResponse): StubbedTransport {
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

  return { requests, fetch };
}

/** A `fetch` that never reaches a server, the way a dropped connection looks. */
export function failingTransport(message = 'Failed to fetch'): ApiFetch {
  return async () => {
    throw new TypeError(message);
  };
}

/**
 * The RPC protocol's success envelope.
 *
 * oRPC does not put the payload at the top level: `StandardRPCSerializer`
 * reads `{ json, meta }` and ignores anything else, which is why every stub
 * here goes through this helper rather than returning a bare object.
 */
export function rpcPayload(value: unknown): { json: unknown; meta: [] } {
  return { json: value, meta: [] };
}
