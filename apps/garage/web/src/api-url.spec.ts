import {
  API_READINESS_PATH,
  API_RPC_SEGMENT,
  apiOriginOf,
  apiOriginOrEmpty,
  apiReadinessUrl,
  apiRpcUrl,
} from './api-url';

/**
 * `NEXT_PUBLIC_API_URL` is the API's base URL and none of the three endpoints
 * derived from it. Each derivation has a specific, known way of being wrong —
 * one of them was in fact wrong until a browser said so — so each is pinned.
 */
describe('apiOriginOf', () => {
  it('drops the API prefix, so Socket.io does not read it as a namespace', () => {
    expect(apiOriginOf('http://localhost:3000/api')).toBe('http://localhost:3000');
  });

  it('keeps a non-default port', () => {
    expect(apiOriginOf('https://api.example.test:8443/api')).toBe('https://api.example.test:8443');
  });

  it('drops a default port, as an origin has no port when it is the scheme default', () => {
    expect(apiOriginOf('https://api.example.test/api')).toBe('https://api.example.test');
  });

  it('throws on a value that is not an absolute URL', () => {
    // `webEnvSchema` validates this with `z.url()` before a server serves
    // anything, so reaching here means the schema was bypassed — which is
    // exactly why this throws rather than returning something plausible.
    // Matched on the message rather than on `TypeError`: the URL parser that
    // throws belongs to whichever realm provides `URL`, and an `instanceof`
    // check across realms is a false negative waiting to happen.
    expect(() => apiOriginOf('/api')).toThrow(/Invalid URL/);
  });
});

describe('apiOriginOrEmpty', () => {
  it('behaves exactly like apiOriginOf on a valid URL', () => {
    expect(apiOriginOrEmpty('http://localhost:3000/api')).toBe('http://localhost:3000');
  });

  it('returns an empty string instead of throwing on a value that is not an absolute URL', () => {
    // `layout.tsx` and `settings/page.tsx` both call this from a Server
    // Component render; a throw there renders the error boundary for every
    // route, login page included, rather than the honest "not configured"
    // fallback each caller wants at build time.
    expect(apiOriginOrEmpty('/api')).toBe('');
  });
});

describe('apiReadinessUrl', () => {
  it('points at /health/ready and NOT at /api/health/ready', () => {
    // `configureApp()` passes the health prefix to `setGlobalPrefix`'s
    // `exclude`, so the probes sit at the server root. Appending the path to
    // the configured URL — prefix included — is the mistake that produces a
    // health check which is red on a healthy deployment.
    expect(apiReadinessUrl('http://localhost:3000/api')).toBe('http://localhost:3000/health/ready');
    expect(apiReadinessUrl('http://localhost:3000/api')).not.toContain('/api/health');
  });

  it('is unaffected by how deep the configured prefix is', () => {
    expect(apiReadinessUrl('https://example.test/some/deep/prefix')).toBe(
      'https://example.test/health/ready'
    );
  });

  it('exposes the path it builds, so the value is assertable on its own', () => {
    expect(API_READINESS_PATH).toBe('/health/ready');
  });
});

describe('apiRpcUrl', () => {
  it('adds the /rpc segment the RPC transport is mounted under', () => {
    // Measured, not deduced: against the running API, `POST /api/me/get`
    // answered 404 and `POST /api/rpc/me/get` answered 401 — the route exists
    // and its guard ran. Handing `NEXT_PUBLIC_API_URL` straight to
    // `createApiClient` (as `doc/auth.md`'s snippet does) 404s every call.
    expect(apiRpcUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api/rpc');
  });

  it('does not double the separator when the configured URL ends in a slash', () => {
    expect(apiRpcUrl('http://localhost:3000/api/')).toBe('http://localhost:3000/api/rpc');
  });

  it('keeps the segment assertable against apps/garage/api/src/orpc/rpc-route.ts', () => {
    // `RPC_ROUTE_PREFIX` there; not importable across the app boundary, so the
    // two are kept honest by name here and by the live call above.
    expect(API_RPC_SEGMENT).toBe('rpc');
  });
});
