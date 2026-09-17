/**
 * A real OIDC issuer, in process, for the auth tests.
 *
 * **Why not a mock.** The claims this task's tests need to make are about
 * cryptography and about three libraries composed: that a token signed by the
 * wrong key is refused, that an expired one is refused, that a rotated `kid`
 * is picked up without a restart. A stubbed `JwksClient` would let all of those
 * pass while the real one failed, which is precisely the "asserted but never
 * exercised" failure this project has already paid for twice. So this serves a
 * genuine discovery document and a genuine JWKS over HTTP, and the tests sign
 * genuine RS256 tokens against it with `node:crypto`.
 *
 * **This is not a test backdoor.** Nothing here is imported by application
 * code — the whole directory is excluded from `tsconfig.app.json`. The
 * application only ever sees an `AUTH_OKTA_ISSUER` pointing at this server, in
 * exactly the way dev and e2e point it at `mock-oauth2-server` and production
 * points it at Okta. There is no branch in `apps/garage/api/src/auth/**` that knows
 * this file exists.
 *
 * Docker is unavailable in the environment this was written in, so
 * `mock-oauth2-server` itself could not be reached; this stands in for it at
 * the same interface (`/.well-known/openid-configuration` → `jwks_uri` → a JWKS
 * of RSA public keys).
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/** One published RSA key pair. */
export interface TestSigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

/** Generates an RSA key pair and labels it with a `kid`. */
export function createSigningKey(kid: string): TestSigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, publicKey };
}

function toJwk(key: TestSigningKey): Record<string, unknown> {
  const jwk = key.publicKey.export({ format: 'jwk' });
  return { ...jwk, kid: key.kid, use: 'sig', alg: 'RS256' };
}

export interface OidcTestIssuer {
  /** The issuer URL — what `AUTH_OKTA_ISSUER` is set to. */
  readonly issuer: string;
  /** How many times the JWKS endpoint has been fetched. Proves caching. */
  readonly jwksRequestCount: number;
  /** Replaces the published key set, simulating a rotation at the IdP. */
  publish(keys: TestSigningKey[]): void;
  /**
   * Makes both endpoints answer 503, simulating an unreachable IdP. A cache
   * miss during an outage must fail closed, never fall through to "valid".
   */
  setAvailable(available: boolean): void;
  /**
   * Overwrites fields of the discovery document, for the two misconfigurations
   * the verifier is expected to refuse: a document that declares somebody
   * else's `issuer`, and one that points `jwks_uri` at another origin.
   */
  overrideDiscovery(fields: Record<string, unknown>): void;
  close(): Promise<void>;
}

/**
 * Starts the issuer on an ephemeral port.
 *
 * The JWKS path is `/jwks` — deliberately *not* Okta's `/v1/keys`. If the
 * implementation ever hardcoded a path instead of reading `jwks_uri` from the
 * discovery document, every test here would fail, which is the point.
 */
export async function startOidcTestIssuer(keys: TestSigningKey[]): Promise<OidcTestIssuer> {
  let published = [...keys];
  let available = true;
  let jwksRequestCount = 0;
  let issuer = '';
  let discoveryOverride: Record<string, unknown> = {};

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0];

    if (!available) {
      response.writeHead(503).end('issuer unavailable');
      return;
    }

    if (path === '/.well-known/openid-configuration') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          issuer,
          jwks_uri: `${issuer}/jwks`,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          ...discoveryOverride,
        })
      );
      return;
    }

    if (path === '/jwks') {
      jwksRequestCount += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: published.map(toJwk) }));
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${port}`;

  return {
    get issuer() {
      return issuer;
    },
    get jwksRequestCount() {
      return jwksRequestCount;
    },
    publish(next: TestSigningKey[]) {
      published = [...next];
    },
    setAvailable(next: boolean) {
      available = next;
    },
    overrideDiscovery(fields: Record<string, unknown>) {
      discoveryOverride = { ...fields };
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
