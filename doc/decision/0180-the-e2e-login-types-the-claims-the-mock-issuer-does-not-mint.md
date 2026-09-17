# 0180 – The e2e login types the claims the mock issuer does not mint

## What

`apps/garage/web-e2e` signs in through the real OIDC authorization-code redirect
against `mock-oauth2-server`. On the issuer's sign-in form it fills two fields,
not one:

- **user/subject** — the persona's `sub` (`dev-admin`, `dev-user`, `dev-user-2`),
- **Optional claims JSON** — `{"email": "...", "name": "..."}`.

There is no other departure from what production does. No token is minted in
the test process, no cookie is written by hand, no `isTest` branch exists
anywhere in `apps/garage/web`, `apps/garage/api` or `libs/garage/auth`, and the second field is a
control the mock server puts on its own login page — not something the
application knows about.

## Why

`mock-oauth2-server` runs with no `JSON_CONFIG` (see `docker-compose.yml`), and
its default token carries exactly `aud, azp, exp, iat, iss, jti, nbf, sub, tid`.
**No `email`. No `name`.**

That is not survivable. `AuthUserService.findOrProvision` resolves a caller by
`sub`, and when the subject is unknown it needs an address to create the row
with:

> A valid token without `email` means the IdP client is missing the `email`
> scope — an operator misconfiguration, logged as such.

— and answers `401 "The token does not identify a provisionable user."`. Against
a database that has not been seeded, or after a seed user is renamed, every
request in the suite fails at that line. The claims are therefore not a
convenience: they are what makes the token the suite presents the same *shape*
of token a real Okta tenant issues for
`OKTA_SCOPES = 'openid profile email offline_access'`.

Three alternatives were considered and rejected:

1. **Rely on the seed alone.** A seeded row has `oktaId: 'dev-user'`, so a
   subject-only token resolves by step 1 and never needs an email. It works — and
   it means the suite never exercises just-in-time provisioning, and turns
   "somebody dropped a seed user" into an unexplained 401 rather than a clear
   one. Supplying the claims covers both paths: seeded rows match on `sub`, and
   an unseeded database provisions.
2. **Mount a `JSON_CONFIG` on the container** that hard-codes claims per subject.
   That moves the same values into infrastructure, makes the personas invisible
   from the spec files that use them, and adds a file that dev and e2e would
   have to keep in step.
3. **A credentials provider, a bypass flag, or a hand-minted JWT.** Explicitly
   out of bounds. The point of running against a real issuer is that the code
   under test is the code that ships.

The persona's `email` deliberately **matches** the seeded row's, and the
persona's `sub` deliberately matches its `oktaId`. That combination resolves at
step 1 (`sub`) and never reaches `AuthUserService`'s email-rebinding fallback,
so the suite cannot silently rewrite the `oktaId` of a seeded account.

## How

- `apps/garage/web-e2e/src/support/personas.ts` — the three personas, each with its
  `subject` and its `claims` object.
- `apps/garage/web-e2e/src/support/oidc-login.ts` — `signInThroughOidc` fills
  `input[name="username"]` and `textarea[name="claims"]`, submits, and waits for
  the application's own URL.
- `apps/garage/web-e2e/src/identity.spec.ts` — signs each persona in and asserts the
  application shows the **seeded** name, email and role. This is what keeps the
  re-stated seed values in `personas.ts` honest; they cannot be imported,
  because `libs/garage/database` is `scope:api` and `apps/garage/web-e2e` is `scope:web`.

## Risk

- **The claims are typed into a form, so they depend on that form's field
  names.** `input[name="username"]` and `textarea[name="claims"]` are
  `mock-oauth2-server`'s markup, and a new major version could rename them. The
  failure would be immediate, total and obvious (every sign-in times out on the
  issuer's page), not subtle.
- **A real Okta tenant will not need this file at all**, which means it is one
  more thing that can rot without anybody noticing. `identity.spec.ts` is the
  mitigation: it fails the moment the claims stop producing the right person.
