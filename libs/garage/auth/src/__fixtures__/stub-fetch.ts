/**
 * Test-only HTTP stubs for the OIDC endpoints this lib talks to.
 *
 * The refresher builds real `Request`s and reads real `Response`s; only the
 * `fetch` underneath is replaced, so the discovery URL, the client
 * authentication method and the form encoding are all actually exercised
 * rather than asserted against a mock's recorded intentions.
 *
 * Lives in `__fixtures__/` because `tsconfig.lib.json` excludes that folder —
 * being unreferenced by `src/index.ts` is not enough to keep a file out of the
 * library's compilation program (same reasoning as
 * `libs/shared/api-client/src/__fixtures__`).
 */

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  /** Request body as text, `''` for a GET. */
  readonly body: string;
}

export interface StubbedFetch {
  /** Every request issued, in order. */
  readonly calls: RecordedRequest[];
  readonly fetch: typeof globalThis.fetch;
}

/** One canned answer. */
export interface StubbedAnswer {
  readonly status?: number;
  /** Serialized to JSON. Use `raw` for a non-JSON body. */
  readonly body?: unknown;
  readonly raw?: string;
}

/**
 * A `fetch` that records what it was asked for and answers from `respond`,
 * which receives the request URL and the zero-based call index.
 */
export function stubFetch(
  respond: (url: string, callIndex: number) => StubbedAnswer
): StubbedFetch {
  const calls: RecordedRequest[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = init?.body === undefined ? '' : String(init.body);

    const answer = respond(url, calls.length);
    calls.push({ url, method, headers, body });

    const payload = answer.raw ?? JSON.stringify(answer.body ?? {});
    return new Response(payload, {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { calls, fetch };
}

/**
 * The discovery document `mock-oauth2-server` and Okta both serve, cut down to
 * the two fields this lib reads.
 */
export function discoveryDocument(
  issuer: string,
  authMethods: readonly string[] = ['client_secret_basic', 'client_secret_post']
): Record<string, unknown> {
  return {
    issuer,
    token_endpoint: `${issuer}/token`,
    token_endpoint_auth_methods_supported: [...authMethods],
  };
}

/**
 * The RPC protocol's success envelope, for the `libs/shared/api-client` integration
 * test. oRPC reads `{ json, meta }` rather than a bare payload.
 */
export function rpcPayload(value: unknown): { json: unknown; meta: [] } {
  return { json: value, meta: [] };
}
