/**
 * An access token obtained the way the browser gets one: the real OIDC
 * authorization-code flow, over plain HTTP.
 *
 * ## Why this file exists
 *
 * `auth.spec.ts` used to consist of four assertions that all said `401`, and
 * nothing in `apps/garage/api-e2e` ever passed the guard. A suite like that does not
 * discriminate between the four bad credentials it presents: `return false` in
 * `JwtAuthGuard`, a misconfigured `AUTH_OKTA_ISSUER`, an unreachable JWKS
 * endpoint, or a verifier that threw on every token would all have left it
 * green. The final review raised it as I-1. A negative control is only evidence
 * when a positive control beside it can fail.
 *
 * ## There is no backdoor here
 *
 * Nothing below signs a token, injects a claim into the API, or asks it to
 * trust a header. It drives `mock-oauth2-server` through `/authorize` and
 * `/token` exactly as Auth.js does — the same endpoints, the same
 * authorization-code grant, the same client credentials — and the API then
 * verifies the result against the issuer's JWKS with the code that runs in
 * production. The only difference from production is the value of
 * `AUTH_OKTA_ISSUER`, which is the difference `doc/decision/0009-*` exists to
 * allow.
 *
 * ## The two facts about the mock issuer this depends on
 *
 * Both measured against `ghcr.io/navikt/mock-oauth2-server` as this repository
 * runs it (no `JSON_CONFIG`):
 *
 * 1. **`sub` is whatever is typed into the login form**, and it is a fresh UUID
 *    when nothing is. So the subject has to be supplied to land on a seeded
 *    account.
 * 2. **The default token carries no `email` and no `name`** — exactly
 *    `aud, azp, exp, iat, iss, jti, nbf, sub, tid`. The form's *Optional claims
 *    JSON* field is how a real Okta token's claims are reproduced, and
 *    `AuthUserService.findOrProvision` refuses a subject it has never seen
 *    without an `email`. `apps/garage/web-e2e/src/support/personas.ts` supplies the
 *    same pair through the browser; see `doc/decision/0180-*`.
 */

import axios from 'axios';

/** A seeded identity, matching `libs/garage/database/src/lib/seed-data.ts`. */
export interface E2ePersona {
  /** The OIDC `sub`; the seeded row's `oktaId`. */
  readonly subject: string;
  /** Claims typed into the mock server's *Optional claims JSON* field. */
  readonly claims: Readonly<Record<string, string>>;
}

/** The ordinary seeded user. Not the admin: nothing here needs a role. */
export const SEEDED_USER: E2ePersona = {
  subject: 'dev-user',
  claims: { email: 'user@example.com', name: 'Dev User' },
};

/** Where the token lands. Never fetched, and never has to exist. */
const REDIRECT_URI = 'http://localhost:4200/api/auth/callback/okta';

/** What `apps/garage/web` asks for; see `OKTA_SCOPES`. */
const SCOPE = 'openid profile email';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. The api-e2e suite needs the same environment the API ` +
        'runs with — copy .env into this worktree (see doc/environment.md).'
    );
  }
  return value;
}

/** Never follows a redirect and never throws on a status; both are the data. */
const raw = { maxRedirects: 0, validateStatus: () => true } as const;

/**
 * Signs `persona` in and returns the access token the API will be offered.
 *
 * Two round trips, each asserted on rather than assumed: the authorization
 * endpoint must answer `302` with a `code`, and the token endpoint must answer
 * `200` with an `access_token`. A failure in either is reported as a setup
 * failure with the status, so a broken issuer never looks like a failed
 * assertion about the API.
 */
export async function fetchAccessToken(persona: E2ePersona = SEEDED_USER): Promise<string> {
  const issuer = required('AUTH_OKTA_ISSUER').replace(/\/+$/, '');
  const clientId = required('AUTH_OKTA_CLIENT_ID');
  const clientSecret = required('AUTH_OKTA_CLIENT_SECRET');

  const authorizeUrl = new URL(`${issuer}/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', SCOPE);
  authorizeUrl.searchParams.set('state', 'api-e2e');

  // The mock server's login form posts back to the same URL. `username` is the
  // `sub`; `claims` is the *Optional claims JSON* textarea.
  const form = new URLSearchParams({
    username: persona.subject,
    claims: JSON.stringify(persona.claims),
  });

  const authorized = await axios.post(authorizeUrl.toString(), form.toString(), {
    ...raw,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  if (authorized.status !== 302) {
    throw new Error(
      `The OIDC issuer did not answer /authorize with a redirect (status ${authorized.status}). ` +
        'Is the mock issuer up? `docker compose --profile dev up -d`.'
    );
  }

  const location = authorized.headers['location'];
  if (typeof location !== 'string') {
    throw new Error('The OIDC issuer redirected without a Location header.');
  }
  const code = new URL(location).searchParams.get('code');
  if (code === null) {
    throw new Error('The OIDC issuer redirected without an authorization code.');
  }

  const exchanged = await axios.post(
    `${issuer}/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    { ...raw, headers: { 'content-type': 'application/x-www-form-urlencoded' } }
  );

  if (exchanged.status !== 200) {
    // The body may carry the client secret back in an error description, so it
    // is deliberately not included.
    throw new Error(`The OIDC token endpoint answered ${exchanged.status}.`);
  }

  const token: unknown = (exchanged.data as { access_token?: unknown }).access_token;
  if (typeof token !== 'string' || token === '') {
    throw new Error('The OIDC token endpoint returned no access_token.');
  }
  return token;
}
