# 0043 – The JWKS endpoint comes from OIDC discovery, and a cache miss never becomes a bypass

**Date:** 2026-09-02 · **Status:** accepted · **Follows on from:** `doc/decision/0008-*`,
`doc/decision/0042-*`

## What

`JwksVerifierService` does not know where the issuer's keys live. It fetches
`${AUTH_OKTA_ISSUER}/.well-known/openid-configuration`, validates the document, and takes
`jwks_uri` from it. The fetch happens **lazily**, on the first token to be verified, and the
resulting `JwksClient` is memoised for the process lifetime.

The document is checked, not merely parsed:

- it must answer 2xx and parse as `{ issuer: string, jwks_uri: url }` (loose object — an IdP
  adding metadata must not break authentication);
- its `issuer` must equal `AUTH_OKTA_ISSUER` (trailing slashes normalised on both sides);
- `jwks_uri` must be on the **same origin** as the issuer.

Every failure — an unreachable issuer, a non-2xx discovery response, a mismatched issuer, an
off-origin `jwks_uri`, a rate-limited JWKS fetch, an unknown `kid` — **throws**. There is no
branch anywhere in the file that returns a key, a claim set, or a truthy result when
something could not be fetched.

`jwks-rsa`'s `cacheMaxAgeFallback` is deliberately **left unset**.

A failed discovery drops the memoised promise, so the next request retries.

## Why

**Why discovery and not a path suffix.** Okta serves its JWKS at `${issuer}/v1/keys`;
`mock-oauth2-server` serves it at `${issuer}/jwks`. A hardcoded suffix works in exactly one
of dev and production. `doc/decision/0008-*` and `.env.example` both commit this project to
"dev, e2e and production run the same code and differ only in the value of
`AUTH_OKTA_ISSUER`" — a hardcoded suffix breaks that promise the first time the code is
deployed against real Okta, and breaks it at runtime, in production, on every request.

The test issuer in `apps/garage/api/src/auth/testing/oidc-test-issuer.ts` publishes at `/jwks`
specifically so that a reintroduced hardcoded `/v1/keys` fails the suite.

**Why lazily.** Resolving discovery in the constructor would make `AppModule` initialisation
depend on the IdP being reachable, so an Okta blip during a deploy would turn into a process
that will not boot. Lazily, the same blip is some failed requests and a recovery.

**Why the issuer must match the document.** A mistyped or stale `AUTH_OKTA_ISSUER` that
happens to resolve to a live OIDC issuer would otherwise cause the API to validate tokens
against *someone else's* keys, with `jsonwebtoken`'s `issuer` check then failing on every
token — an outage whose cause ("wrong tenant") is invisible. Comparing the declared issuer
makes it a loud, named error on the first request.

**Why `jwks_uri` must share the issuer's origin.** It is the one field in the document that
decides which bytes become a trusted public key. A tampered document (a compromised
discovery endpoint, a hijacked DNS entry for a *different* host, a copy-paste error in a
private IdP's config) that points `jwks_uri` elsewhere would hand key material selection to
whoever controls that other host. Same-origin is a cheap invariant that both Okta and
`mock-oauth2-server` satisfy naturally.

**Why `cacheMaxAgeFallback` is not enabled.** `jwks-rsa` documents it as "keep serving the
last known good key while the JWKS endpoint is unreachable". That window is precisely the
window in which a key that has just been revoked — say, because it leaked — continues to be
trusted, and an attacker who can also make the endpoint unreachable controls the window's
length. The availability it buys is small (the cache already covers the common case, and an
IdP outage means logins are broken anyway); the security it costs is exactly the thing key
rotation exists for.

**Why a failed discovery must not be permanent.** Memoising `buildClient()` without clearing
it on rejection means one transient network error at the wrong moment leaves every
subsequent request inheriting the same rejected promise until the process restarts. That is
a self-inflicted outage from a blip.

## How

Rotation does **not** depend on the cache TTL expiring. `jwks-rsa` memoises per `kid` and
does not cache failures, so a token signed with a *new* `kid` is a cache miss and forces an
immediate refetch. A rotated key is therefore picked up by the first request that uses it,
not up to ten minutes later. The 10-minute `cacheMaxAge` only bounds how long a *withdrawn*
key stays usable.

That opens a flooding vector — an anonymous caller can present tokens with random `kid`s and
make the API hammer the IdP — which is why `rateLimit: true, jwksRequestsPerMinute: 12` is
set. Hitting the limit raises an error, so the request is rejected. See
`doc/decision/0042-*` for the availability cost that carries.

`jwks-verifier.service.spec.ts` runs against a real in-process OIDC issuer with real RSA
keys and covers: discovery is used (the JWKS is served from a non-Okta path), the key is
cached rather than refetched per request, a live rotation is picked up, a withdrawn key stops
working, an unreachable issuer **fails closed**, and the service **recovers** once the issuer
returns. The last one was verified by mutation — removing the `catch` that clears the
memoised promise makes it, and only it, fail.

## Risk if this is wrong

**The same-origin rule assumes the IdP does not delegate its JWKS to another host.** Okta
does not. If this project ever adopts an IdP that serves keys from a CDN on a different
origin, this check will fail closed — an outage, not a breach, but a confusing one. The error
message names the reason for that case.

**The discovery document is fetched over plain HTTP in dev.** `AUTH_OKTA_ISSUER` is
`http://localhost:8080/default` against `mock-oauth2-server`; in production it is an `https`
Okta URL. Nothing in the code enforces `https`, because doing so would require an
environment branch — which this project forbids in auth (`doc/decision/0008-*`). The
protection is that the production value is `https` and env validation (`z.url()`) plus
deployment review are what keep it so. This is the one place where the "no test branch"
rule and a defence-in-depth check are in tension, and the rule wins.

**Failing closed is a deliberate availability trade.** An IdP outage means every request is
rejected, including from callers whose key is already cached but whose cache entry has just
expired. That is correct and it is also the reason `cacheMaxAgeFallback` looks tempting.
Anyone reconsidering it should read the "Why" above first.
