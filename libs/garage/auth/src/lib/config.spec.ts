/**
 * The three callbacks that turn a one-hour Okta token into a working session,
 * and the configuration they hang off.
 *
 * The rotation tests below drive `createAuthConfig`'s **real** `jwt` callback,
 * with only `fetch` replaced — so the discovery request, the client
 * authentication and the token request are all genuinely made. Nothing here
 * branches on the environment: the same object is built for dev, e2e and
 * production, which is the rule the API side has to hold to as well.
 */

import type { Account, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
// Module imports, not `../index`: `createAuthConfig` and the callbacks it is
// built from are `createAuth`'s implementation and are deliberately absent
// from the barrel, which publishes the entry point and nothing else.
// `sharedRevokedStore` and `sharedRefreshStates` were always reached this way —
// both hand out process-global mutable state, and the tests are the only
// things that need to reset them between cases.
import {
  createAuthConfig,
  isAuthorized,
  OKTA_SCOPES,
  projectSession,
  rotateAccessToken,
} from './config';
import type { AuthOptions } from './config';
import { OKTA_PROVIDER_ID, REFRESH_TOKEN_ERROR } from './session';
import { REFRESH_SKEW_SECONDS } from './refresh';
import type { TokenRefresher } from './refresh';
import { sharedRevokedStore } from './revocation';
import { sharedRefreshStates } from './refresh';
import { discoveryDocument, stubFetch } from '../__fixtures__/stub-fetch';

const ISSUER = 'https://example.okta.test/oauth2/default';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

const OPTIONS: AuthOptions = {
  issuer: ISSUER,
  clientId: 'garage-web',
  clientSecret: 'super-secret',
  secret: 'a'.repeat(32),
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * `createAuthConfig` deliberately reaches for two pieces of process-global
 * state — the revocation map and the refresh state — because Next.js runs it
 * once per bundle and all three copies have to agree. That is exactly the state
 * a test file has to reset, or one case inherits the previous one's sign-out or
 * its cached discovery document.
 */
beforeEach(() => {
  sharedRevokedStore().clear();
  sharedRefreshStates().clear();
});

const ACCOUNT: Account = {
  provider: OKTA_PROVIDER_ID,
  providerAccountId: 'okta-user-1',
  type: 'oidc',
  access_token: 'first-access-token',
  expires_at: nowSeconds() + 3600,
  refresh_token: 'first-refresh-token',
};

/** A refresher that always succeeds, and records that it was called. */
function succeedingRefresher(): TokenRefresher & { calls: string[] } {
  const calls: string[] = [];
  const refresh = async (refreshToken: string) => {
    calls.push(refreshToken);
    return {
      accessToken: 'renewed-access-token',
      expiresAt: nowSeconds() + 3600,
      refreshToken: 'renewed-refresh-token',
    };
  };
  return Object.assign(refresh, { calls });
}

/** A refresher that always fails, the way a revoked refresh token behaves. */
const failingRefresher: TokenRefresher = async () => {
  throw new Error('invalid_grant');
};

describe('rotateAccessToken (the jwt callback)', () => {
  describe('at sign-in', () => {
    it('stores the tokens the account carries', async () => {
      const token = await rotateAccessToken({}, ACCOUNT, succeedingRefresher());

      expect(token).toMatchObject({
        accessToken: 'first-access-token',
        expiresAt: ACCOUNT.expires_at,
        refreshToken: 'first-refresh-token',
      });
      expect(token.error).toBeUndefined();
    });

    it('clears a previous failure', async () => {
      const token = await rotateAccessToken(
        { error: REFRESH_TOKEN_ERROR },
        ACCOUNT,
        succeedingRefresher()
      );

      expect(token.error).toBeUndefined();
      expect(token.accessToken).toBe('first-access-token');
    });

    it('fails closed when the provider issued no access token', async () => {
      const { access_token: _accessToken, ...withoutToken } = ACCOUNT;

      const token = await rotateAccessToken({}, withoutToken, succeedingRefresher());

      expect(token.error).toBe(REFRESH_TOKEN_ERROR);
      expect(token.accessToken).toBeUndefined();
    });
  });

  describe('on a later request', () => {
    it('leaves a healthy token alone and does not call the provider', async () => {
      const refresher = succeedingRefresher();
      const healthy: JWT = {
        accessToken: 'still-good',
        expiresAt: nowSeconds() + 3600,
        refreshToken: 'r',
      };

      const token = await rotateAccessToken(healthy, null, refresher);

      expect(token).toBe(healthy);
      expect(refresher.calls).toEqual([]);
    });

    it('renews before the token expires, not after', async () => {
      const refresher = succeedingRefresher();
      // Still valid for another half minute — the API would accept it — but
      // inside the renewal skew, which is the whole point.
      const stillValidFor = REFRESH_SKEW_SECONDS - 30;
      const expiring: JWT = {
        accessToken: 'about-to-expire',
        expiresAt: nowSeconds() + stillValidFor,
        refreshToken: 'refresh-me',
      };

      const token = await rotateAccessToken(expiring, null, refresher);

      expect(refresher.calls).toEqual(['refresh-me']);
      expect(token.accessToken).toBe('renewed-access-token');
      expect(token.refreshToken).toBe('renewed-refresh-token');
      expect(token.error).toBeUndefined();
    });

    it('renews a token that has already expired', async () => {
      const refresher = succeedingRefresher();

      await rotateAccessToken(
        { accessToken: 'dead', expiresAt: nowSeconds() - 10, refreshToken: 'refresh-me' },
        null,
        refresher
      );

      expect(refresher.calls).toEqual(['refresh-me']);
    });

    it('drops the access token when the renewal fails', async () => {
      // Not a stale bearer: an absent Authorization header reads as
      // "unauthenticated", which the UI handles, whereas a dead token produces
      // a 401 indistinguishable from a bug.
      const token = await rotateAccessToken(
        { accessToken: 'dead', expiresAt: nowSeconds() - 10, refreshToken: 'revoked' },
        null,
        failingRefresher
      );

      expect(token.error).toBe(REFRESH_TOKEN_ERROR);
      expect(token.accessToken).toBeUndefined();
      expect(token.refreshToken).toBeUndefined();
    });

    it('fails closed when there is no refresh token to use', async () => {
      const refresher = succeedingRefresher();

      const token = await rotateAccessToken(
        { accessToken: 'dead', expiresAt: nowSeconds() - 10 },
        null,
        refresher
      );

      expect(token.error).toBe(REFRESH_TOKEN_ERROR);
      expect(refresher.calls).toEqual([]);
    });

    it('fails closed when the token has no expiry at all', async () => {
      const token = await rotateAccessToken(
        { accessToken: 'mystery', refreshToken: 'r' },
        null,
        succeedingRefresher()
      );

      expect(token.error).toBe(REFRESH_TOKEN_ERROR);
    });

    it('does not retry a session that already failed', async () => {
      const refresher = succeedingRefresher();
      const failed: JWT = { error: REFRESH_TOKEN_ERROR };

      const token = await rotateAccessToken(failed, null, refresher);

      expect(token).toBe(failed);
      expect(refresher.calls).toEqual([]);
    });
  });
});

describe('projectSession (the session callback)', () => {
  const session: Session = { user: { email: 'a@b.test' }, expires: '2099-01-01T00:00:00.000Z' };

  it('exposes the access token the transports need', () => {
    const projected = projectSession(session, { accessToken: 'bearer-me' });

    expect(projected.accessToken).toBe('bearer-me');
    expect(projected.error).toBeUndefined();
  });

  it('never exposes the refresh token', () => {
    const projected = projectSession(session, {
      accessToken: 'bearer-me',
      refreshToken: 'must-not-leave-the-server',
    });

    expect(JSON.stringify(projected)).not.toContain('must-not-leave-the-server');
  });

  it('reports a failed refresh and withholds the token', () => {
    const projected = projectSession(session, { error: REFRESH_TOKEN_ERROR });

    expect(projected.error).toBe(REFRESH_TOKEN_ERROR);
    expect(projected.accessToken).toBeUndefined();
  });

  it('cannot leave a stale token behind on a failed session', () => {
    const stale: Session = { ...session, accessToken: 'previously-issued' };

    const projected = projectSession(stale, { error: REFRESH_TOKEN_ERROR });

    expect(projected.accessToken).toBeUndefined();
  });

  it('keeps the identity fields Auth.js put there', () => {
    const projected = projectSession(session, { accessToken: 'bearer-me' });

    expect(projected.user?.email).toBe('a@b.test');
    expect(projected.expires).toBe(session.expires);
  });
});

describe('isAuthorized (the middleware callback)', () => {
  const authenticated: Session = {
    user: { email: 'a@b.test' },
    expires: '2099-01-01T00:00:00.000Z',
  };

  it('turns an unauthenticated request away', () => {
    // `false` is what makes Auth.js middleware redirect to the sign-in page
    // instead of letting the route answer with a bare 401.
    expect(isAuthorized(null)).toBe(false);
  });

  it('turns away a session whose refresh failed', () => {
    expect(isAuthorized({ ...authenticated, error: REFRESH_TOKEN_ERROR })).toBe(false);
  });

  it('lets a signed-in user through', () => {
    expect(isAuthorized(authenticated)).toBe(true);
  });
});

describe('createAuthConfig', () => {
  /**
   * `Okta({...})` returns `{ id, name, type, checks, style, options }` — the
   * caller's settings are parked under `options` and merged into the provider
   * by Auth.js at request time (`@auth/core/providers/okta.js`). Reading them
   * from there is what these assertions have to do; asserting them at the top
   * level would silently pass against `undefined`.
   */
  function oktaProvider(config: ReturnType<typeof createAuthConfig>) {
    return config.providers[0] as {
      id?: string;
      type?: string;
      checks?: readonly string[];
      options?: {
        id?: string;
        issuer?: string;
        clientId?: string;
        clientSecret?: string;
        authorization?: { params?: { scope?: string } };
      };
    };
  }

  it('registers exactly one Okta provider, under the id the callback URL uses', () => {
    const config = createAuthConfig(OPTIONS);
    const provider = oktaProvider(config);

    expect(config.providers).toHaveLength(1);
    expect(provider.type).toBe('oidc');
    // `/api/auth/callback/okta` is derived from this id — it is the URL that
    // has to be registered with Okta, so it is not free to drift.
    expect(provider.id).toBe(OKTA_PROVIDER_ID);
    expect(provider.options).toMatchObject({
      id: OKTA_PROVIDER_ID,
      issuer: ISSUER,
      clientId: OPTIONS.clientId,
      clientSecret: OPTIONS.clientSecret,
    });
  });

  it('keeps the PKCE and state checks the provider ships with', () => {
    expect(oktaProvider(createAuthConfig(OPTIONS)).checks).toEqual(['pkce', 'state']);
  });

  it('requests offline_access, without which Okta issues no refresh token', () => {
    const provider = oktaProvider(createAuthConfig(OPTIONS));

    expect(OKTA_SCOPES.split(' ')).toContain('offline_access');
    expect(provider.options?.authorization?.params?.scope).toBe(OKTA_SCOPES);
  });

  it('keeps the session in a JWT, since there is no database adapter', () => {
    expect(createAuthConfig(OPTIONS).session?.strategy).toBe('jwt');
    expect(createAuthConfig(OPTIONS).adapter).toBeUndefined();
  });

  it('takes the secret from its argument and reads no environment variable', () => {
    expect(createAuthConfig(OPTIONS).secret).toBe(OPTIONS.secret);
  });

  it('points at the application sign-in page only when one is given', () => {
    expect(createAuthConfig(OPTIONS).pages).toBeUndefined();
    expect(createAuthConfig({ ...OPTIONS, signInPath: '/login' }).pages?.signIn).toBe('/login');
  });

  it('renews an expiring token through a real discovery and token request', async () => {
    // End to end through the configured callback: only `fetch` is stubbed.
    const server = stubFetch((url) =>
      url === DISCOVERY_URL
        ? { body: discoveryDocument(ISSUER) }
        : { body: { access_token: 'renewed', expires_in: 3600 } }
    );
    const config = createAuthConfig({ ...OPTIONS, fetch: server.fetch });

    const token = await config.callbacks?.jwt?.({
      token: {
        // `sub` is not decoration: `@auth/core` sets one on every session, and
        // the `jwt` callback now refuses a token it cannot key for revocation.
        // A fixture without it is a shape production never produces.
        sub: 'e3f1a2b4-0c7d-4e2a-9f10-8b6c5d4e3f21',
        accessToken: 'about-to-expire',
        expiresAt: nowSeconds() + (REFRESH_SKEW_SECONDS - 30),
        refreshToken: 'refresh-me',
      },
      user: {},
      account: null,
    });

    expect(server.calls.map((call) => call.url)).toEqual([DISCOVERY_URL, `${ISSUER}/token`]);
    expect(token).toMatchObject({ accessToken: 'renewed' });
  });

  it('sends one grant when two configurations renew the same token at once', async () => {
    // The shape of the real deployment, and the defect `doc/decision/0245-*`
    // fixes: Next.js builds the proxy, the `/api/auth/*` handlers and the
    // server components separately, so `createAuthConfig` runs three times in
    // one `next start` — the same measurement `revokes across configurations`
    // below rests on. The proxy and the root layout then read the **same**
    // request cookie, so inside the renewal skew they present the same refresh
    // token. With an in-flight slot per closure they both exchanged it; the
    // final review measured two grants where `doc/decision/0051-*` promised
    // one, and with rotation enabled on the authorization server the second
    // comes back `invalid_grant` and signs the user out mid-session.
    //
    // This drives the wired `jwt` callbacks, not the refresher, because the
    // defect could just as easily be a missing wire as a wrong rule: a
    // refresher that coalesces perfectly and is handed private state per
    // configuration looks exactly like the bug from outside.
    const tokenUrl = `${ISSUER}/token`;
    const urls: string[] = [];
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const fetchImpl: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      if (url === DISCOVERY_URL) {
        return new Response(JSON.stringify(discoveryDocument(ISSUER)), { status: 200 });
      }
      await gate;
      return new Response(JSON.stringify({ access_token: 'renewed', expires_in: 3600 }), {
        status: 200,
      });
    };

    const proxySide = createAuthConfig({ ...OPTIONS, fetch: fetchImpl });
    const serverComponentSide = createAuthConfig({ ...OPTIONS, fetch: fetchImpl });

    const expiring = (): JWT => ({
      sub: 'e3f1a2b4-0c7d-4e2a-9f10-8b6c5d4e3f21',
      accessToken: 'about-to-expire',
      expiresAt: nowSeconds() + (REFRESH_SKEW_SECONDS - 30),
      refreshToken: 'one-cookie-one-refresh-token',
    });

    const first = proxySide.callbacks?.jwt?.({ token: expiring(), user: {}, account: null });
    // Wait for the grant to be genuinely on the wire, so the second caller
    // arrives mid-flight rather than in the same tick — coalescing only within
    // one tick would not help the real case.
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      if (urls.filter((url) => url === tokenUrl).length === 1) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    const second = serverComponentSide.callbacks?.jwt?.({
      token: expiring(),
      user: {},
      account: null,
    });

    openGate();
    const [a, b] = await Promise.all([first, second]);

    expect(urls.filter((url) => url === tokenUrl)).toHaveLength(1);
    expect(urls.filter((url) => url === DISCOVERY_URL)).toHaveLength(1);
    expect(a).toMatchObject({ accessToken: 'renewed' });
    expect(b).toMatchObject({ accessToken: 'renewed' });
  });

  it('reports a failed renewal on the session rather than swallowing it', async () => {
    const server = stubFetch((url) =>
      url === DISCOVERY_URL
        ? { body: discoveryDocument(ISSUER) }
        : { status: 400, body: { error: 'invalid_grant' } }
    );
    const config = createAuthConfig({ ...OPTIONS, fetch: server.fetch });

    const token = await config.callbacks?.jwt?.({
      token: {
        sub: 'e3f1a2b4-0c7d-4e2a-9f10-8b6c5d4e3f21',
        accessToken: 'dead',
        expiresAt: nowSeconds() - 10,
        refreshToken: 'revoked',
      },
      user: {},
      account: null,
    });

    expect(token).toMatchObject({ error: REFRESH_TOKEN_ERROR });

    /**
     * Auth.js types this parameter as the **intersection** of its two session
     * shapes — `{ user: AdapterUser } & AdapterSession & Session` — which no
     * runtime object can satisfy (`expires` would have to be `Date & string`).
     * Under `strategy: 'jwt'` only the `Session` half is ever passed. The cast
     * names that gap instead of papering over it; what is asserted below is
     * the behaviour, not the type.
     */
    type SessionCallbackParams = Parameters<
      NonNullable<NonNullable<typeof config.callbacks>['session']>
    >[0];
    const session = await config.callbacks?.session?.({
      session: { user: { email: 'a@b.test' }, expires: '2099-01-01T00:00:00.000Z' },
      token: token as JWT,
      newSession: undefined,
    } as unknown as SessionCallbackParams);

    expect(session).toMatchObject({ error: REFRESH_TOKEN_ERROR });
    // …and the middleware callback turns that into a redirect, not a 401.
    expect(isAuthorized(session as Session)).toBe(false);
  });
});

/**
 * Sign-out, and the reason it has to reach further than the cookie.
 *
 * These drive the **wired** configuration — `config.events.signOut` followed by
 * `config.callbacks.jwt` — rather than the registry on its own, because the
 * defect this fixes could just as easily be a missing wire as a wrong rule. A
 * registry that works perfectly and is never consulted looks exactly like the
 * bug from the outside.
 *
 * `null` is the contract with `@auth/core`: its session action reads a `null`
 * from the `jwt` callback as "this session is over" and answers by clearing the
 * session cookie instead of re-issuing it. That is what makes a cookie which
 * survived the sign-out race delete itself on its next use.
 */
describe('sign-out revocation', () => {
  /**
   * Two subjects, shaped like what `@auth/core` actually mints: a fresh UUID per
   * **sign-in**, not a per-person id. `SESSION_B` is the same human being
   * signing in a second time.
   */
  const SESSION_A = '9efdd0ac-6b1e-4d0e-9a7d-2b5c1f0a3e11';
  const SESSION_B = '15326704-0c8a-4a1f-8d33-7e9b2c4d6a02';

  /** A configuration whose refresher can never be reached over the network. */
  function config() {
    const server = stubFetch(() => ({ body: discoveryDocument(ISSUER) }));
    return createAuthConfig({ ...OPTIONS, fetch: server.fetch });
  }

  /** A healthy, non-expiring session token for one sign-in session. */
  const liveToken = (sub: string, iat = nowSeconds() - 60): JWT => ({
    sub,
    iat,
    accessToken: 'still-good',
    expiresAt: nowSeconds() + 3600,
    refreshToken: 'unused',
  });

  it('revokes across configurations, not just the one that signed out', async () => {
    // The shape of the real deployment, and the reason the first attempt at
    // this fix did nothing: Next.js builds the proxy, the `/api/auth/*`
    // handlers and the server components separately, so `createAuthConfig` runs
    // three times in one process — measured. Sign-out lands on one of them; the
    // authorization check that matters runs on another.
    const signOutSide = createAuthConfig(OPTIONS);
    const authorizingSide = createAuthConfig(OPTIONS);

    await signOutSide.events?.signOut?.({ token: liveToken(SESSION_A) });

    expect(
      await authorizingSide.callbacks?.jwt?.({
        token: liveToken(SESSION_A),
        user: {},
        account: null,
      })
    ).toBeNull();
  });

  it('leaves a session alone when nobody has signed out', async () => {
    const c = config();

    const token = await c.callbacks?.jwt?.({
      token: liveToken(SESSION_A),
      user: {},
      account: null,
    });

    expect(token).toMatchObject({ accessToken: 'still-good' });
  });

  it('ends the session that signed out', async () => {
    const c = config();

    await c.events?.signOut?.({ token: liveToken(SESSION_A) });
    const token = await c.callbacks?.jwt?.({
      token: liveToken(SESSION_A),
      user: {},
      account: null,
    });

    expect(token).toBeNull();
  });

  it('ends a token re-encoded after the sign-out, whatever its issued-at says', async () => {
    // The defect itself, and the case the previous `iat`-cutoff design could
    // lose. `iat` is stamped at *encode* time, and `rotateAccessToken` — with a
    // possible refresh round trip — runs between the revocation check and that
    // encode, so a racing render can emit an `iat` seconds *after* the
    // sign-out. `sub` is unchanged by re-encoding, so membership still refuses
    // it.
    const c = config();

    await c.events?.signOut?.({ token: liveToken(SESSION_A, nowSeconds() - 60) });
    const token = await c.callbacks?.jwt?.({
      token: liveToken(SESSION_A, nowSeconds() + 5),
      user: {},
      account: null,
    });

    expect(token).toBeNull();
  });

  it('does not end a different session', async () => {
    const c = config();

    await c.events?.signOut?.({ token: liveToken(SESSION_A) });
    const token = await c.callbacks?.jwt?.({
      token: liveToken(SESSION_B),
      user: {},
      account: null,
    });

    expect(token).toMatchObject({ accessToken: 'still-good' });
  });

  it('honours a fresh sign-in, which arrives as a brand-new subject', async () => {
    // Signing out and back in must work, and it does so without any "forget"
    // step: `@auth/core` mints `id: crypto.randomUUID()` for every completed
    // sign-in and copies it to `token.sub`, so the new session is a subject
    // this registry has never seen. Verified live — the same persona signing in
    // twice produced `9efdd0ac…` then `15326704…`.
    const c = config();
    await c.events?.signOut?.({ token: liveToken(SESSION_A) });

    const signedIn = await c.callbacks?.jwt?.({
      token: { sub: SESSION_B },
      user: {},
      account: ACCOUNT,
    });
    expect(signedIn).toMatchObject({ accessToken: ACCOUNT.access_token });

    // …and the session that sign-in produced survives the next request.
    const next = await c.callbacks?.jwt?.({
      token: liveToken(SESSION_B),
      user: {},
      account: null,
    });
    expect(next).toMatchObject({ accessToken: 'still-good' });
  });

  it('records the sign-out before Auth.js writes the cookie clear', async () => {
    // `@auth/core` awaits `events.signOut` and only then pushes the clearing
    // cookie (`lib/actions/signout.js`), so an async event must be finished
    // before the response leaves. Asserting the promise settles is what stops
    // a future refactor from making this fire-and-forget.
    const c = config();
    const result = c.events?.signOut?.({ token: liveToken(SESSION_A) });

    await expect(Promise.resolve(result)).resolves.not.toThrow();
    expect(
      await c.callbacks?.jwt?.({ token: liveToken(SESSION_A), user: {}, account: null })
    ).toBeNull();
  });
});
