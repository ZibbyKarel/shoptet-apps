# 0279 – The api-e2e suite signs in for real before it asserts a refusal

## What

`apps/garage/api-e2e/src/support/oidc-token.ts` fetches an access token from the mock
OIDC issuer through the ordinary authorization-code flow, over plain HTTP.
`apps/garage/api-e2e/src/api/auth.spec.ts` opens with three tests that use it:

- `POST /api/rpc/me/get` with the token answers `200` and the seeded person's
  record;
- the identical request without the header answers `401`;
- the feed at `/api/calendar/<that person's icsToken>.ics` answers `200`
  `text/calendar`.

`apps/garage/api-e2e/project.json` no longer passes `--passWithNoTests`.

## Why

- **Eight assertions, all of them satisfied by an API that refuses everyone.**
  The file had four tests asserting `401` and one asserting that an unknown ICS
  token 404s like an unrouted path, and **no request in the project had ever
  passed the guard**: `api.spec.ts` hits `/health/live` and `/health/ready`,
  both excluded from the global prefix, and asserts `/api` is `401` too. So
  `return false` in `JwtAuthGuard`, a misconfigured `AUTH_OKTA_ISSUER`, an
  unreachable JWKS endpoint, or a verifier that threw on every token would all
  have left the suite green — while it presented four *different* bad
  credentials as though it discriminated between them. The ICS case had the same
  shape: a calendar route that 404s on everything also passed it.
- **Measured, and the measurement is the point.** With the API started from its
  own production build and `AUTH_OKTA_AUDIENCE` set to a wrong value — a
  "guard that denies everyone", introduced without editing a line of the
  application — the eight pre-existing tests **all still passed** and only the
  three new ones failed. That is the finding demonstrated and the fix
  demonstrated in one run.
- **`--passWithNoTests` made the target green when the specs stopped matching**,
  which is the one failure mode a refusal-only suite cannot be trusted to
  notice.

## How

- **No backdoor.** The helper drives `mock-oauth2-server`'s `/authorize` and
  `/token` endpoints exactly as Auth.js does — same grant, same client id and
  secret, same redirect URI — and the API then verifies the result against the
  issuer's JWKS with the code that runs in production. Nothing signs a token,
  injects a claim, or asks the API to trust a header. The only difference from
  production is the value of `AUTH_OKTA_ISSUER`, which is the difference
  `doc/decision/0009-*` exists to allow.
- **Two measured facts about the mock issuer are handled explicitly**, and both
  are the reason a naive token does not work:
  1. `sub` is whatever is typed into the login form and a fresh UUID when
     nothing is, so the subject is supplied (`dev-user`) in order to land on the
     seeded account rather than provisioning a stranger;
  2. the default token carries exactly `aud, azp, exp, iat, iss, jti, nbf, sub,
     tid` — **no `email`, no `name`** — so both are supplied through the form's
     *Optional claims JSON* field, the same way
     `apps/garage/web-e2e/src/support/personas.ts` does through the browser
     (`doc/decision/0180-*`). Without an `email`,
     `AuthUserService.findOrProvision` refuses the subject.
- The assertions are on `email`, `name`, and the presence of `id` and `role` —
  the last two because they come from the database row, not from the token, so
  they are what proves the token was resolved to an identity rather than
  believed.
- The ICS positive control takes its token from `me.get`, which is where a real
  user gets theirs. The value is never asserted on and never printed: a failure
  message is a log line.

## Risk

- **The suite now needs the mock issuer running**, not just the API. It was
  already true that it needed a database (the readiness probe), and
  `docker compose --profile dev up -d` starts both. A missing issuer is reported
  as a setup failure naming the command, not as a failed assertion about the
  API.
- **The three new tests each do a full sign-in**, adding two HTTP round trips
  apiece. Measured at 11 tests in the same run that used to hold 8, with no
  perceptible change in wall-clock time; caching the token across tests was
  rejected because a shared token is a shared failure.
- **`api-e2e` still has no `test` target and its `e2e` target is still not in
  CI.** Both are outside this shard's ownership (`.github/`), and the second is
  the one that matters: this positive control only protects anything once
  something runs it. It was run by hand for this change — 11 passed, exit 0.
