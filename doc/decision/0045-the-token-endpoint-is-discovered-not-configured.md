# 0045 – The token endpoint and its client-authentication method come from OIDC discovery

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 20 (`libs/garage/auth`)

## What

`libs/garage/auth`'s refresh token rotation does not have a configured token endpoint. Given
`AUTH_OKTA_ISSUER`, it fetches `${issuer}/.well-known/openid-configuration` once per
refresher and reads two fields:

- `token_endpoint` — where the `refresh_token` grant is sent;
- `token_endpoint_auth_methods_supported` — whether the client id and secret go in an HTTP
  Basic header (`client_secret_basic`) or in the request body (`client_secret_post`).

No second environment variable was added, and neither value is hard-coded.

## Why

**Auth.js does the code exchange for us; it does not refresh.** Once the OAuth2 callback has
run, Auth.js holds the tokens in the session cookie and never renews them. The renewal is
ours to write, which means we — not the library — have to know where the token endpoint is.

**The Auth.js guide hard-codes Google.** `authjs.dev/guides/refresh-token-rotation` posts to
`https://oauth2.googleapis.com/token` with `client_id`/`client_secret` in the body. Copying
that shape for Okta gets two things wrong at once:

- the endpoint would have to become a new environment variable, which then has to stay
  consistent with `AUTH_OKTA_ISSUER` across `.env.example`, dev, e2e and production by hand;
- `client_secret_post` is Google's requirement. Okta registers web applications with
  `client_secret_basic` by default, so the body form would fail against a real org while
  passing against `mock-oauth2-server`, which accepts both — the worst possible split,
  because e2e would stay green.

**One issuer, one document, both halves of the system.** `AUTH_OKTA_ISSUER` is already the
single Okta URL in `.env.example`, shared by `apps/garage/web` and `apps/garage/api`, and the API's JWKS
lookup (Task 11) discovers its keys from the same document. Deriving the token endpoint the
same way keeps "dev, e2e and production run the same code, only the values differ" true for
refresh as well as for validation — which is global constraint 8's requirement, not a
preference.

**Discovery is one extra request, cached.** The document is fetched at most once per
refresher and the *promise* is cached, so concurrent renewals share a single request.

**Alternative rejected: read the method from configuration.** An `authMethod: 'basic' |
'post'` option would work, but it is a value the provider already publishes and that we would
then have to keep correct by hand for two different providers (`mock-oauth2-server` and
Okta). A setting that can disagree with the server is a setting that will.

## How

`createTokenRefresher({ issuer, clientId, clientSecret, fetch? })` in
`libs/garage/auth/src/lib/refresh.ts`. The cache is a `let` inside the returned closure rather than a
module-level `Map`: a module-global cache would have needed a reset hook for tests, and a
reset hook only tests call is precisely the production-code test seam this project bans
elsewhere. A failed discovery clears the cache so the next renewal retries.

When the document advertises no methods at all, Basic is used — the OIDC default for a
confidential client.

Exercised in `refresh.spec.ts`: the discovery URL (with and without a trailing slash on the
issuer), the document fetched once across two renewals, a failed discovery *not* cached, and
all three client-authentication branches asserted on the actual request the stubbed `fetch`
received. The Basic case also asserts the secret is **not** additionally in the body — sending
it twice is how a strict authorization server answers `invalid_request`.

## Risk if this is wrong

An identity provider that serves no discovery document, or serves one without
`token_endpoint`, cannot be used. Both cases throw `TokenRefreshError` naming the URL, which
fails the session closed rather than silently. That is acceptable: OIDC discovery is mandatory
for an OpenID Provider, and both providers this project targets serve it.

The auth-method heuristic prefers Basic whenever it is advertised. A provider that lists
`client_secret_basic` but only really accepts `client_secret_post` would fail — no such
provider is known, and the failure would be a loud `invalid_client` on the first renewal, not
a silent degradation.
