/**
 * Refresh token rotation against the OIDC provider.
 *
 * Auth.js renews nothing on its own: once the OAuth2 callback has run, the
 * access token in the session cookie ages out and the API starts rejecting it.
 * This module is the half of the `jwt` callback that talks to Okta — kept
 * separate from `config.ts` so the network shape (discovery, client
 * authentication, error mapping) can be exercised without constructing an
 * Auth.js instance.
 *
 * The token endpoint is **discovered**, not configured. `AUTH_OKTA_ISSUER` is
 * the only Okta URL in the environment (`.env.example`, `apps/garage/web/src/env.ts`),
 * and the same variable drives the API's JWKS lookup — pointing both at
 * `mock-oauth2-server` in dev/e2e and at the real org in production, with no
 * code change and no test-only branch.
 */

/**
 * How long before expiry a token is considered due for renewal, in seconds.
 *
 * Renewing exactly at `exp` guarantees a race: the request that carries the
 * token still has to travel, and the API compares against its own clock. A
 * minute is enough to cover both, and short enough that a token is never held
 * far past its useful life.
 */
import { processGlobalMap } from './process-global';

export const REFRESH_SKEW_SECONDS = 60;

/**
 * Whether an access token expiring at `expiresAt` (unix seconds) should be
 * renewed now.
 *
 * Pure and exported so the "renew *before* expiry" rule is a fact a test can
 * check, rather than an inequality buried in a callback.
 */
export function shouldRefresh(expiresAt: number, nowMs: number = Date.now()): boolean {
  return nowMs >= (expiresAt - REFRESH_SKEW_SECONDS) * 1000;
}

/** The subset of the OIDC discovery document this module reads. */
interface DiscoveryDocument {
  readonly token_endpoint?: unknown;
  readonly token_endpoint_auth_methods_supported?: unknown;
}

/** A renewed set of tokens, in this project's camelCase. */
export interface RefreshedTokens {
  readonly accessToken: string;
  /** Unix seconds. */
  readonly expiresAt: number;
  /**
   * The refresh token to store for next time. Okta rotates refresh tokens when
   * the app is configured to, and returns nothing when it is not — in which
   * case this is the token that was sent, so the caller can store it
   * unconditionally.
   */
  readonly refreshToken: string;
}

/**
 * The two things a refresher shares with its siblings: the discovery promise and
 * the grant currently on the wire.
 *
 * A mutable bag rather than a closure, because coalescing is only worth anything
 * if *every* refresher for one issuer and client sees the same slot — see
 * {@link sharedRefreshState}.
 */
export interface TokenRefreshState {
  /**
   * The discovery document request, cached as a *promise* so concurrent
   * renewals share one round trip. Reset to `undefined` on failure so a
   * transient outage does not poison the issuer forever.
   */
  discovery?: Promise<TokenEndpoint> | undefined;
  /**
   * The renewal currently on the wire, if any, keyed by the refresh token that
   * started it. Cleared as soon as it settles — this coalesces concurrent
   * callers, it does not cache a result.
   */
  inFlight?: { refreshToken: string; result: Promise<RefreshedTokens> } | undefined;
}

/** What discovery is read for. */
interface TokenEndpoint {
  readonly tokenEndpoint: string;
  readonly useBasicAuth: boolean;
}

export interface TokenRefresherOptions {
  /** OIDC issuer, e.g. `https://example.okta.com/oauth2/default`. */
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Override the `fetch` used for discovery and the token request. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Where the discovery promise and the in-flight grant live. Defaults to a
   * private bag, which is what a test wants; the application passes
   * {@link sharedRefreshState} — see there for why that is not optional in
   * Next.js.
   *
   * The same shape, and the same reasoning, as
   * `SignOutRegistryOptions.revoked`: the process-global state is named at the
   * call site instead of being reached for from inside a module.
   */
  readonly state?: TokenRefreshState;
}

/** Renews an access token from a refresh token. */
export type TokenRefresher = (refreshToken: string) => Promise<RefreshedTokens>;

/**
 * Thrown when renewal fails.
 *
 * The message carries only the HTTP status and the OAuth2 `error` /
 * `error_description` fields — never the response body, and never a token.
 * A token endpoint's error body is small and well specified; dumping it
 * wholesale is how a refresh token ends up in a log file.
 */
export class TokenRefreshError extends Error {
  override readonly name = 'TokenRefreshError';
}

/** `${issuer}/.well-known/openid-configuration`, tolerating a trailing slash. */
function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
}

function readErrorFields(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const { error, error_description: description } = body as Record<string, unknown>;
  const parts = [
    typeof error === 'string' ? error : undefined,
    typeof description === 'string' ? description : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? ` (${parts.join(': ')})` : '';
}

/**
 * Reads the response body as JSON, or `undefined` if it is not JSON at all.
 * Used only on the error path, where an HTML error page from a proxy is a
 * realistic possibility and must not turn into a second, confusing failure.
 */
async function readJsonOrUndefined(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * The one refresh-state table for the whole Node process.
 *
 * No runtime guard: unlike `sharedRevokedStore`, this one's failure mode off
 * the Node.js runtime is a redundant token grant, not a security control
 * quietly not holding — see {@link sharedRefreshState} for the full trade.
 *
 * Deliberately not re-exported from `libs/garage/auth/src/index.ts`: it hands out a
 * process-global mutable map that any importer could clear.
 */
export const sharedRefreshStates = processGlobalMap<TokenRefreshState>('token-refresh-state');

/**
 * The refresh state for one issuer and client, shared by every bundle in the
 * process.
 *
 * **The sharing is not defensive style; without it the coalescing does not
 * cover the case it exists for.** `createAuthConfig` runs three times in one
 * `next start`, once per Next.js bundle (`processGlobalMap` in
 * `./process-global` has the measurement). A refresher whose in-flight slot
 * lives in a closure therefore has two siblings that cannot see it, and the
 * proxy and the root layout — which read the **same request cookie** — each
 * send their own `refresh_token` grant. Measured before this fix: two grants
 * where `doc/decision/0051-*` promised one.
 *
 * Keyed by issuer **and** client id, not by refresh token: the token is the key
 * *inside* {@link TokenRefreshState.inFlight}, and one process could in
 * principle serve more than one authorization server. Sharing a discovery
 * document between two issuers would send a grant to the wrong token endpoint.
 *
 * ### Why this does not refuse a non-Node runtime the way `sharedRevokedStore` does
 *
 * `sharedRevokedStore` throws off the Node.js runtime because its failure mode
 * is a **security control quietly not holding**. This one's failure mode is a
 * redundant token grant — the exact behaviour that shipped before this fix. A
 * boot failure would be the wrong trade for that on its own.
 *
 * A non-Node runtime does still fail to boot, but **not** in the order an
 * earlier version of this comment claimed. Measured: `createAuthConfig` calls
 * `sharedRefreshState()` at `config.ts:288` and `sharedRevokedStore()` at
 * `config.ts:301`, so this function runs *first* and this state is created
 * before the revocation store's runtime guard ever fires. What saves it is not
 * ordering but that both calls sit in the same expression evaluation:
 * `sharedRevokedStore()` throws thirteen lines later, `createAuthConfig` throws
 * with it, and the half-built config is never returned to a caller. The state
 * left on `globalThis` is unreachable garbage in a process that is already
 * failing to start.
 *
 * The distinction matters if these two calls are ever separated — moved into
 * different functions, or one made lazy. Then this one would run alone, and
 * would need its own guard.
 */
export function sharedRefreshState(issuer: string, clientId: string): TokenRefreshState {
  const states = sharedRefreshStates();
  // `JSON.stringify` rather than a delimiter: any separator character good
  // enough to be collision-proof is one that cannot appear in a URL, and the
  // obvious choice (`\0`) makes this file *binary* to `grep` and `rg`, which
  // skip it silently. That cost a reviewer real time — the C-1 fix looked
  // deleted because searching for it returned nothing. Encoding the pair is
  // collision-proof for the same reason and stays greppable.
  const key = JSON.stringify([issuer, clientId]);
  let state = states.get(key);
  if (state === undefined) {
    state = {};
    states.set(key, state);
  }
  return state;
}

/**
 * Builds a refresher bound to one issuer and client.
 *
 * The discovery document is fetched at most once per {@link TokenRefreshState}
 * — the *promise* is cached, so concurrent renewals share a single request.
 *
 * The token request is coalesced the same way: concurrent callers presenting
 * the same refresh token share one grant, which is what stops a rotating
 * authorization server from invalidating the token under its own siblings. See
 * the comment on the returned function and `doc/decision/0051-*`.
 *
 * Both live in `options.state`, which the application points at
 * {@link sharedRefreshState} so that the three refreshers Next.js builds share
 * one slot. A closure would give each of them a private one, which is what
 * `doc/decision/0051-*` used to claim was enough and is not.
 */
export function createTokenRefresher(options: TokenRefresherOptions): TokenRefresher {
  const { issuer, clientId, clientSecret } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const state: TokenRefreshState = options.state ?? {};

  async function discover(): Promise<TokenEndpoint> {
    const url = discoveryUrl(issuer);
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new TokenRefreshError(`OIDC discovery at ${url} failed with HTTP ${response.status}.`);
    }
    const document = (await response.json()) as DiscoveryDocument;
    const tokenEndpoint = document.token_endpoint;
    if (typeof tokenEndpoint !== 'string' || tokenEndpoint === '') {
      throw new TokenRefreshError(`OIDC discovery at ${url} returned no usable "token_endpoint".`);
    }

    // Okta registers web apps with `client_secret_basic` by default, while the
    // Auth.js refresh-rotation guide hard-codes `client_secret_post` (which is
    // what Google wants). Reading the advertised methods instead of picking one
    // is what makes the same code work against both the real org and
    // `mock-oauth2-server`. When the document says nothing, `client_secret_basic`
    // is the OIDC default for a confidential client.
    const methods = document.token_endpoint_auth_methods_supported;
    const supported = Array.isArray(methods)
      ? methods.filter((method): method is string => typeof method === 'string')
      : [];
    const useBasicAuth =
      supported.length === 0
        ? true
        : supported.includes('client_secret_basic') || !supported.includes('client_secret_post');

    return { tokenEndpoint, useBasicAuth };
  }

  async function exchange(refreshToken: string): Promise<RefreshedTokens> {
    state.discovery ??= discover();
    const started = state.discovery;
    let endpoint: TokenEndpoint;
    try {
      endpoint = await started;
    } catch (error) {
      // A failed discovery must not poison the refresher forever — the next
      // renewal (minutes later) gets a fresh attempt. Cleared only if this is
      // still the current promise, so a slow failure cannot wipe a newer
      // attempt's cache (the same rule the in-flight slot below follows).
      if (state.discovery === started) state.discovery = undefined;
      throw error;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    if (endpoint.useBasicAuth) {
      // RFC 6749 §2.3.1: client id and secret are form-urlencoded before being
      // base64'd, which matters as soon as a secret contains `+` or `/`.
      const credentials = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
      headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    } else {
      body.set('client_id', clientId);
      body.set('client_secret', clientSecret);
    }

    const response = await fetchImpl(endpoint.tokenEndpoint, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const details = readErrorFields(await readJsonOrUndefined(response));
      throw new TokenRefreshError(`Token refresh failed with HTTP ${response.status}${details}.`);
    }

    const tokens = (await response.json()) as Record<string, unknown>;
    const accessToken = tokens['access_token'];
    const expiresIn = tokens['expires_in'];
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new TokenRefreshError('Token refresh returned no "access_token".');
    }
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) {
      throw new TokenRefreshError('Token refresh returned no usable "expires_in".');
    }
    const rotated = tokens['refresh_token'];

    return {
      accessToken,
      expiresAt: Math.floor(Date.now() / 1000 + expiresIn),
      // Okta only returns a new refresh token when rotation is enabled on the
      // authorization server; keeping the old one otherwise is what stops the
      // *next* renewal from failing with `invalid_grant`.
      refreshToken: typeof rotated === 'string' && rotated !== '' ? rotated : refreshToken,
    };
  }

  return function refresh(refreshToken: string): Promise<RefreshedTokens> {
    // Several requests can read the session inside the same renewal window — a
    // page whose layout, Server Component and Route Handler each `await auth()`
    // is three, and they are not even served by the same bundle. With
    // refresh-token rotation enabled on the authorization server, the first
    // grant invalidates the token and the rest come back `invalid_grant`, which
    // fails the session closed and signs the user out mid-session. Sharing one
    // in-flight request removes that for every caller in this process —
    // *including* the ones on Next.js's other two bundles, which is what
    // `state` being process-global buys and a closure did not.
    // Residual races and the multi-process case: `doc/decision/0051-*`.
    const current = state.inFlight;
    if (current?.refreshToken === refreshToken) return current.result;

    const result = exchange(refreshToken);
    const entry = { refreshToken, result };
    state.inFlight = entry;

    // Cleared only if this is still the current entry, so a slow failure cannot
    // wipe a newer renewal's slot. `.then(f, f)` handles the rejection on this
    // derived promise; the original is still returned to the caller, which is
    // what reports the error.
    const clear = () => {
      if (state.inFlight === entry) state.inFlight = undefined;
    };
    result.then(clear, clear);

    return result;
  };
}
