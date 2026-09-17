/**
 * What the refresher actually puts on the wire, and when.
 *
 * These tests import only from within this lib and never `next-auth`; the last
 * test in this file reads its own source to keep that true (same device as
 * `libs/shared/api-client/src/lib/api-client.spec.ts`). They name `./refresh`
 * directly because the refresher is `createAuth`'s implementation and is not
 * published from the barrel.
 */

import { readFileSync } from 'node:fs';
import {
  createTokenRefresher,
  REFRESH_SKEW_SECONDS,
  shouldRefresh,
  TokenRefreshError,
} from './refresh';
// The shared refresh state is a process-global mutable table; only its own
// tests touch it.
import { sharedRefreshState, sharedRefreshStates } from './refresh';
import type { TokenRefreshState } from './refresh';
import { discoveryDocument, stubFetch } from '../__fixtures__/stub-fetch';

const ISSUER = 'https://example.okta.test/oauth2/default';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const TOKEN_URL = `${ISSUER}/token`;
const CLIENT_ID = 'garage-web';
const CLIENT_SECRET = 'super-secret';
const REFRESH_TOKEN = 'refresh-token-value';

/** Unix seconds, as `expires_at` is expressed. */
const nowSeconds = () => Math.floor(Date.now() / 1000);

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'new-access-token',
    expires_in: 3600,
    token_type: 'Bearer',
    ...overrides,
  };
}

/** Answers discovery, then every token request, with the canned bodies. */
function oidcServer(
  answer: Record<string, unknown> = tokenResponse(),
  status = 200,
  authMethods?: readonly string[]
) {
  return stubFetch((url) =>
    url === DISCOVERY_URL
      ? {
          body:
            authMethods === undefined
              ? discoveryDocument(ISSUER)
              : discoveryDocument(ISSUER, authMethods),
        }
      : { status, body: answer }
  );
}

/**
 * Spins the microtask queue until `condition` holds, so a test can wait for a
 * request to have *gone out* without a real timer or an arbitrary sleep.
 */
async function until(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

/**
 * An OIDC server whose **token** responses are held open until `release()` is
 * called, so a second caller can be made to arrive while the first grant is
 * genuinely in flight. Discovery answers immediately.
 */
function gatedOidcServer(answer: Record<string, unknown> = tokenResponse(), status = 200) {
  const urls: string[] = [];
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });

  const fetch: typeof globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);

    if (url === DISCOVERY_URL) {
      return new Response(JSON.stringify(discoveryDocument(ISSUER)), { status: 200 });
    }
    await gate;
    return new Response(JSON.stringify(answer), { status });
  };

  return {
    urls,
    fetch,
    tokenRequests: () => urls.filter((url) => url === TOKEN_URL).length,
    release: () => open(),
  };
}

function refresherFor(server: ReturnType<typeof oidcServer>) {
  return createTokenRefresher({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    fetch: server.fetch,
  });
}

describe('shouldRefresh', () => {
  it('leaves a token that is nowhere near expiry alone', () => {
    expect(shouldRefresh(nowSeconds() + 3600)).toBe(false);
  });

  it('renews while the token is still valid, not once it has expired', () => {
    // The whole point of the skew: at this instant the token is still good for
    // another half minute, and the API would accept it — but the request that
    // carries it has to travel, and the API compares against its own clock.
    const stillValidFor = 30;
    expect(stillValidFor).toBeLessThan(REFRESH_SKEW_SECONDS);
    expect(shouldRefresh(nowSeconds() + stillValidFor)).toBe(true);
  });

  it('renews a token that has already expired', () => {
    expect(shouldRefresh(nowSeconds() - 1)).toBe(true);
  });

  it('flips exactly one skew before expiry', () => {
    const nowMs = 1_700_000_000_000;
    const expiresAt = nowMs / 1000 + REFRESH_SKEW_SECONDS;

    expect(shouldRefresh(expiresAt, nowMs - 1)).toBe(false);
    expect(shouldRefresh(expiresAt, nowMs)).toBe(true);
  });
});

describe('createTokenRefresher', () => {
  it('discovers the token endpoint from the issuer instead of hard-coding it', async () => {
    const server = oidcServer();

    await refresherFor(server)(REFRESH_TOKEN);

    expect(server.calls[0]?.url).toBe(DISCOVERY_URL);
    expect(server.calls[0]?.method).toBe('GET');
    expect(server.calls[1]?.url).toBe(TOKEN_URL);
    expect(server.calls[1]?.method).toBe('POST');
  });

  it('tolerates a trailing slash on the issuer', async () => {
    const server = oidcServer();
    const refresh = createTokenRefresher({
      issuer: `${ISSUER}/`,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetch: server.fetch,
    });

    await refresh(REFRESH_TOKEN);

    expect(server.calls[0]?.url).toBe(DISCOVERY_URL);
  });

  it('fetches the discovery document once and reuses it', async () => {
    const server = oidcServer();
    const refresh = refresherFor(server);

    await refresh(REFRESH_TOKEN);
    await refresh(REFRESH_TOKEN);

    expect(server.calls.filter((call) => call.url === DISCOVERY_URL)).toHaveLength(1);
    expect(server.calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(2);
  });

  it('does not cache a failed discovery', async () => {
    let discoveryAttempts = 0;
    const server = stubFetch((url) => {
      if (url === DISCOVERY_URL) {
        discoveryAttempts += 1;
        return discoveryAttempts === 1
          ? { status: 503, body: {} }
          : { body: discoveryDocument(ISSUER) };
      }
      return { body: tokenResponse() };
    });
    const refresh = refresherFor(server);

    await expect(refresh(REFRESH_TOKEN)).rejects.toBeInstanceOf(TokenRefreshError);
    await expect(refresh(REFRESH_TOKEN)).resolves.toMatchObject({
      accessToken: 'new-access-token',
    });
    expect(discoveryAttempts).toBe(2);
  });

  it('rejects a discovery document with no token endpoint', async () => {
    const server = stubFetch(() => ({ body: { issuer: ISSUER } }));

    await expect(refresherFor(server)(REFRESH_TOKEN)).rejects.toThrow(/token_endpoint/);
  });

  describe('client authentication', () => {
    it('uses HTTP Basic when the provider advertises client_secret_basic', async () => {
      const server = oidcServer(tokenResponse(), 200, ['client_secret_basic']);

      await refresherFor(server)(REFRESH_TOKEN);

      const token = server.calls[1];
      const expected = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
      expect(token?.headers.get('authorization')).toBe(`Basic ${expected}`);
      // The secret must not also be in the body — sending it twice is how a
      // strict authorization server answers `invalid_request`.
      expect(token?.body).not.toContain('client_secret');
    });

    it('falls back to the request body when only client_secret_post is advertised', async () => {
      const server = oidcServer(tokenResponse(), 200, ['client_secret_post']);

      await refresherFor(server)(REFRESH_TOKEN);

      const token = server.calls[1];
      expect(token?.headers.get('authorization')).toBeNull();
      const body = new URLSearchParams(token?.body ?? '');
      expect(body.get('client_id')).toBe(CLIENT_ID);
      expect(body.get('client_secret')).toBe(CLIENT_SECRET);
    });

    it('defaults to Basic when the document advertises nothing', async () => {
      const server = oidcServer(tokenResponse(), 200, []);

      await refresherFor(server)(REFRESH_TOKEN);

      expect(server.calls[1]?.headers.get('authorization')).toMatch(/^Basic /);
    });
  });

  it('sends the refresh_token grant', async () => {
    const server = oidcServer();

    await refresherFor(server)(REFRESH_TOKEN);

    const body = new URLSearchParams(server.calls[1]?.body ?? '');
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe(REFRESH_TOKEN);
    expect(server.calls[1]?.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
  });

  it('turns expires_in into an absolute expiry', async () => {
    const server = oidcServer(tokenResponse({ expires_in: 300 }));
    const before = nowSeconds();

    const tokens = await refresherFor(server)(REFRESH_TOKEN);

    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 300);
    expect(tokens.expiresAt).toBeLessThanOrEqual(nowSeconds() + 300);
  });

  it('stores a rotated refresh token when the provider issues one', async () => {
    const server = oidcServer(tokenResponse({ refresh_token: 'rotated' }));

    await expect(refresherFor(server)(REFRESH_TOKEN)).resolves.toMatchObject({
      refreshToken: 'rotated',
    });
  });

  it('keeps the old refresh token when the provider does not rotate', async () => {
    const server = oidcServer(tokenResponse());

    await expect(refresherFor(server)(REFRESH_TOKEN)).resolves.toMatchObject({
      refreshToken: REFRESH_TOKEN,
    });
  });

  describe('failures', () => {
    it('reports the status and the OAuth2 error code', async () => {
      const server = oidcServer(
        { error: 'invalid_grant', error_description: 'The refresh token is invalid' },
        400
      );

      await expect(refresherFor(server)(REFRESH_TOKEN)).rejects.toThrow(
        /HTTP 400 \(invalid_grant: The refresh token is invalid\)/
      );
    });

    it('never puts a token in the error message', async () => {
      // The provider echoing the credential back is exactly the case that turns
      // a "log the response body" shortcut into a leaked refresh token.
      const server = oidcServer(
        {
          error: 'invalid_grant',
          error_description: 'invalid',
          refresh_token: REFRESH_TOKEN,
          access_token: 'leaked-access-token',
        },
        400
      );

      const error = await refresherFor(server)(REFRESH_TOKEN).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(TokenRefreshError);
      expect(String(error)).not.toContain(REFRESH_TOKEN);
      expect(String(error)).not.toContain('leaked-access-token');
    });

    it('survives an error body that is not JSON at all', async () => {
      const server = stubFetch((url) =>
        url === DISCOVERY_URL
          ? { body: discoveryDocument(ISSUER) }
          : { status: 502, raw: '<html>Bad Gateway</html>' }
      );

      await expect(refresherFor(server)(REFRESH_TOKEN)).rejects.toThrow(/HTTP 502/);
    });

    it('rejects a 200 response with no access token', async () => {
      const server = oidcServer({ expires_in: 3600 });

      await expect(refresherFor(server)(REFRESH_TOKEN)).rejects.toThrow(/access_token/);
    });

    it('rejects a 200 response with no usable expiry', async () => {
      const server = oidcServer({ access_token: 'a', expires_in: 'soon' });

      await expect(refresherFor(server)(REFRESH_TOKEN)).rejects.toThrow(/expires_in/);
    });
  });

  describe('concurrent renewals', () => {
    function gatedRefresher(server: ReturnType<typeof gatedOidcServer>) {
      return createTokenRefresher({
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        fetch: server.fetch,
      });
    }

    it('coalesces callers presenting the same refresh token into one grant', async () => {
      // The race this closes: a page whose layout, Server Component and Route
      // Handler each `await auth()` inside the renewal window sends three
      // `refresh_token` grants. With rotation enabled the first invalidates the
      // token and the rest come back `invalid_grant`, which fails the session
      // closed and signs the user out mid-session.
      const server = gatedOidcServer(tokenResponse({ refresh_token: 'rotated' }));
      const refresh = gatedRefresher(server);

      const first = refresh(REFRESH_TOKEN);
      // Wait for the grant to be genuinely on the wire, so the second caller
      // arrives mid-flight rather than in the same tick — coalescing only in
      // the same tick would not help the real case.
      await until(() => server.tokenRequests() === 1, 'the first grant to go out');
      const second = refresh(REFRESH_TOKEN);

      server.release();
      const [a, b] = await Promise.all([first, second]);

      expect(server.tokenRequests()).toBe(1);
      expect(a).toEqual(b);
      expect(a.refreshToken).toBe('rotated');
    });

    it('does not share a grant between different refresh tokens', async () => {
      // Two sessions renewing at once are unrelated; sharing would hand one
      // user's tokens to another.
      const server = gatedOidcServer();
      const refresh = gatedRefresher(server);

      const first = refresh(REFRESH_TOKEN);
      await until(() => server.tokenRequests() === 1, 'the first grant to go out');
      const second = refresh('a-different-session-refresh-token');
      await until(() => server.tokenRequests() === 2, 'the second grant to go out');

      server.release();
      await Promise.all([first, second]);

      expect(server.tokenRequests()).toBe(2);
    });

    it('coalesces, it does not cache: a later renewal makes its own request', async () => {
      // Holding the result would mean serving an access token minted for an
      // earlier moment, and would keep the refresh token in memory after the
      // request that needed it.
      const server = oidcServer();
      const refresh = refresherFor(server);

      await refresh(REFRESH_TOKEN);
      await refresh(REFRESH_TOKEN);

      expect(server.calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(2);
    });

    it('coalesces across the separate refreshers Next.js builds, not just within one', async () => {
      // **The case the closure version could not cover, and the reason
      // `doc/decision/0245-*` exists.** Every other test in this describe uses
      // one refresher, which is the one arrangement production never has:
      // Next.js compiles the proxy, the `/api/auth/*` handlers and the server
      // components separately, so `createAuthConfig` — and with it
      // `createTokenRefresher` — runs three times in one process. The proxy and
      // the root layout read the *same* request cookie, so inside the 60-second
      // skew they hold the same refresh token and, with a private in-flight
      // slot each, both exchange it. Measured before the fix: two grants.
      const server = gatedOidcServer(tokenResponse({ refresh_token: 'rotated' }));
      const shared: TokenRefreshState = {};
      const options = {
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        fetch: server.fetch,
        state: shared,
      };
      const onTheProxyBundle = createTokenRefresher(options);
      const onTheServerComponentBundle = createTokenRefresher(options);

      const first = onTheProxyBundle(REFRESH_TOKEN);
      await until(() => server.tokenRequests() === 1, 'the first grant to go out');
      const second = onTheServerComponentBundle(REFRESH_TOKEN);

      server.release();
      const [a, b] = await Promise.all([first, second]);

      expect(server.tokenRequests()).toBe(1);
      expect(a).toEqual(b);
      expect(a.refreshToken).toBe('rotated');
      // Discovery is shared too, so the second bundle does not re-fetch the
      // document the first already has.
      expect(server.urls.filter((url) => url === DISCOVERY_URL)).toHaveLength(1);
    });

    it('does not share a slot between refreshers given separate state', async () => {
      // The counterfactual for the test above, and what the default is: a
      // refresher built without a `state` gets a private bag, so tests stay
      // isolated from one another. This is what production looked like before
      // the fix — two grants for one refresh token.
      const server = gatedOidcServer(tokenResponse({ refresh_token: 'rotated' }));
      const options = {
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        fetch: server.fetch,
      };
      const first = createTokenRefresher(options)(REFRESH_TOKEN);
      await until(() => server.tokenRequests() === 1, 'the first grant to go out');
      const second = createTokenRefresher(options)(REFRESH_TOKEN);
      await until(() => server.tokenRequests() === 2, 'the second grant to go out');

      server.release();
      await Promise.all([first, second]);

      expect(server.tokenRequests()).toBe(2);
    });

    it('clears the slot after a failure, so the next attempt is not stuck on it', async () => {
      let attempts = 0;
      const server = stubFetch((url) => {
        if (url === DISCOVERY_URL) return { body: discoveryDocument(ISSUER) };
        attempts += 1;
        return attempts === 1
          ? { status: 400, body: { error: 'temporarily_unavailable' } }
          : { body: tokenResponse() };
      });
      const refresh = refresherFor(server);

      await expect(refresh(REFRESH_TOKEN)).rejects.toBeInstanceOf(TokenRefreshError);
      await expect(refresh(REFRESH_TOKEN)).resolves.toMatchObject({
        accessToken: 'new-access-token',
      });
      expect(attempts).toBe(2);
    });
  });

  describe('sharedRefreshState', () => {
    beforeEach(() => sharedRefreshStates().clear());

    it('hands the same state to two independent module registries', () => {
      // **This is the test that pins the fix**, and it is here because the
      // equivalent one was missing for `sharedRevokedStore` — the final review
      // deleted that function's whole `globalThis` body, replaced it with a
      // module-level `const Map`, and got 100/100 green. Two calls inside one
      // module registry cannot tell "one slot per module registry" (the
      // production bug) from "one slot per realm" (the fix).
      //
      // `jest.isolateModules` gives a fresh registry per call, which is the
      // closest thing in-process to what Next.js's three bundles do.
      let first: TokenRefreshState | undefined;
      let second: TokenRefreshState | undefined;

      jest.isolateModules(() => {
        first = jest
          .requireActual<typeof import('./refresh')>('./refresh')
          .sharedRefreshState(ISSUER, CLIENT_ID);
      });
      jest.isolateModules(() => {
        second = jest
          .requireActual<typeof import('./refresh')>('./refresh')
          .sharedRefreshState(ISSUER, CLIENT_ID);
      });

      expect(first).toBeDefined();
      expect(first).toBe(second);

      // Identity is the mechanism; this is the property it buys — the grant one
      // bundle has on the wire is visible to the next bundle that asks.
      const inFlight = {
        refreshToken: REFRESH_TOKEN,
        result: Promise.resolve({ accessToken: 'a', expiresAt: 0, refreshToken: REFRESH_TOKEN }),
      };
      if (first !== undefined) first.inFlight = inFlight;
      expect(second?.inFlight).toBe(inFlight);
    });

    it('keeps one issuer and client apart from another', () => {
      // One process could serve more than one authorization server; sharing a
      // discovery document between two issuers would send a grant to the wrong
      // token endpoint.
      expect(sharedRefreshState(ISSUER, CLIENT_ID)).toBe(sharedRefreshState(ISSUER, CLIENT_ID));
      expect(sharedRefreshState(ISSUER, CLIENT_ID)).not.toBe(
        sharedRefreshState(ISSUER, 'another-client')
      );
      expect(sharedRefreshState(ISSUER, CLIENT_ID)).not.toBe(
        sharedRefreshState('https://other.okta.test/oauth2/default', CLIENT_ID)
      );
    });
  });

  it('is exercised here without importing next-auth', () => {
    // `libs/garage/auth` owns the `next-auth` import, but these tests are
    // application-shaped usage of the wrapper's own API; this pins that none of
    // it needed the wrapped package — a claim that would otherwise quietly stop
    // being true the first time someone reaches for an Auth.js type here.
    const source = readFileSync(__filename, 'utf8');

    expect(source).not.toMatch(/from\s+['"]next-auth/);
    expect(source).not.toMatch(/require\(\s*['"]next-auth/);
  });
});
