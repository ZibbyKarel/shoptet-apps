# Authentication and authorization

This document describes how a person becomes an identified caller: how `apps/garage/web` signs them
in against Okta and keeps a session, and how the token that session holds becomes a user in
`apps/garage/api` — where the token comes from, how it is verified against the issuer's JWKS, how a
user row appears on somebody's first ever request, and what happens when a signing key
rotates. The source of truth is the code; when they disagree, trust the code.

The frontend half is `libs/garage/auth`, the wrapper over next-auth v5 / Auth.js, consumed by
`apps/garage/web`. The backend half is `apps/garage/api/src/auth/`. Env variables are also documented in
`doc/environment.md`; the error shapes referenced below are in `doc/api-operations.md` and
`doc/decision/0033-*`.

---

## The one rule that shapes all of this

**Dev, e2e and production run the same code. Only env values differ.**

There is no `NODE_ENV` check, no `isTest` flag, no "skip auth locally" branch anywhere in
`apps/garage/api/src/auth/**`, and no bypass flag, credentials provider or test-only branch anywhere
in `libs/garage/auth` (global constraint 8). Local development points `AUTH_OKTA_ISSUER` at the
`mock-oauth2-server` container from `docker-compose.yml`; production points it at the Okta
org. The code cannot tell the difference and is not permitted to try.

This is why the JWKS endpoint is discovered rather than hardcoded (Okta and
`mock-oauth2-server` publish it at different paths), why `libs/garage/auth` discovers the
authorization and token endpoints from the same document, and why the tests stand up a real
OIDC issuer instead of stubbing the verifier.

---

## The pieces

The backend half, `apps/garage/api/src/auth/`:

| file                                    | role                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `jwks-verifier.service.ts`              | OIDC discovery, the single cached `JwksClient`, `getSigningKey()`, `verifyToken()`     |
| `jwt-verify-options.ts`                 | the one rule set both verification paths apply                                        |
| `jwt.strategy.ts`                       | `passport-jwt` plumbing; delegates keys, rules and provisioning                        |
| `jwt-auth.guard.ts`                     | the global default-deny guard; honours `@Public()`                                    |
| `public.decorator.ts`                   | `@Public()` — the route-level opt-out                                                 |
| `roles.guard.ts`, `roles.decorator.ts`  | `@Roles('ADMIN')`                                                                     |
| `current-user.decorator.ts`             | `@CurrentUser()`                                                                      |
| `authenticated-user.ts`                 | the `AuthenticatedUser` shape and its runtime check                                   |
| `failure-log-throttle.ts`               | one log line per failure kind per minute, with a suppressed count                     |
| `auth-user.service.ts`                  | just-in-time provisioning, `icsToken`, deactivated → `FORBIDDEN`                      |
| `token-claims.ts`                       | the Zod claim schema, parsed **after** verification                                   |
| `auth.module.ts`                        | wiring; exports the verifier and the user service for Task 15                         |

The frontend half is one lib, `libs/garage/auth`, with two entry points — `@garage/auth` for the
server and `@garage/auth/client` for the browser. See _Using it from the app_.

---

## The flow, end to end

### 0. Sign-in and session

`apps/garage/web` never handles a password. Auth.js redirects to the issuer, exchanges the
authorization code server-side, and keeps the result in an encrypted httpOnly cookie.

```
browser                    apps/garage/web (Next.js server)          Okta / mock-oauth2-server
   │                                │                                    │
   │  GET /any-protected-route      │                                    │
   ├───────────────────────────────►│                                    │
   │                                │  middleware → callbacks.authorized │
   │  302 to the sign-in page       │  (no session → false)              │
   │◄───────────────────────────────┤                                    │
   │  signIn('okta')                │                                    │
   ├───────────────────────────────►│  302 to /authorize (PKCE + state)  │
   │◄────────────────────────────────────────────────────────────────────┤
   │  … user authenticates …                                             │
   ├────────────────────────────────────────────────────────────────────►│
   │  302 /api/auth/callback/okta   │                                    │
   ├───────────────────────────────►│  code → /token                     │
   │                                ├───────────────────────────────────►│
   │                                │  access_token, refresh_token, id_token
   │                                │◄───────────────────────────────────┤
   │                                │  callbacks.jwt seeds the JWT       │
   │  Set-Cookie: encrypted, httpOnly session                            │
   │◄───────────────────────────────┤                                    │

later, from the browser:
   │  GET /api/auth/session (poll, every 300 s)                          │
   ├───────────────────────────────►│  callbacks.jwt → renew if within   │
   │                                │  60 s of expiry ───────────────────►│
   │                                │◄─────────────── new access_token ──┤
   │  { user, accessToken, expires }│  callbacks.session projects it     │
   │◄───────────────────────────────┤                                    │
```

### 1. Frontend → API

Every call to the API carries the access token from that session as
`Authorization: Bearer <jwt>`. Nothing else is accepted — not a cookie, not a query
parameter. A token in a URL ends up in access logs, `Referer` headers and browser history,
so `ExtractJwt.fromAuthHeaderAsBearerToken()` is the only extractor configured.

### 2. Guards, in order

`AppModule` registers three global guards, and the order is load-bearing:

```
ThrottlerGuard  →  JwtAuthGuard  →  RolesGuard
```

- `ThrottlerGuard` first, so rate limiting also applies to unauthenticated traffic.
- `JwtAuthGuard` next. It is an `APP_GUARD`, so **every route is authenticated by default** —
  a controller written tomorrow is protected without anybody remembering to decorate it.
- `RolesGuard` last, because it reads the `request.user` that `JwtAuthGuard` set.

Registering `RolesGuard` before `JwtAuthGuard` would make every `@Roles()` route answer 401.

### 3. Finding the key

`JwtStrategy` hands the raw token to `JwksVerifierService.getSigningKey()`, which:

1. decodes the **JOSE header only** (`jwt.decode`, no verification) to read `kid` and `alg`.
   This is the only part of an unverified token that is ever read — you cannot choose a key
   without knowing which key was claimed;
2. refuses immediately if `alg` is not `RS256`. `{"alg":"none"}` and an HMAC forgery signed
   with the public key an attacker downloaded from the JWKS endpoint both stop here, before
   any network call;
3. resolves the issuer's `jwks_uri` (see _Discovery_ below) and asks the cached `JwksClient`
   for the key with that `kid`.

Every failure throws. Nothing in this file returns a fallback key or a truthy result when a
key could not be fetched.

### 4. Verifying

`jsonwebtoken.verify` checks, against the rules in `jwt-verify-options.ts`:

| rule         | value                                                    | source     |
| ------------ | -------------------------------------------------------- | ---------- |
| signature    | RS256 against the JWKS key                               | the issuer |
| `algorithms` | `['RS256']` — an allow-list, never the token's own claim | constant   |
| `issuer`     | must equal `AUTH_OKTA_ISSUER`                            | env        |
| `audience`   | must equal `AUTH_OKTA_AUDIENCE`                          | env        |
| expiry       | `ignoreExpiration: false`, no clock tolerance            | constant   |

**Only then** are the claims parsed, by `authTokenClaimsSchema`. Nothing downstream reads a
claim that has not been through this.

> **A trap worth knowing about.** `passport-jwt` overwrites `issuer`, `audience`,
> `algorithms` and `ignoreExpiration` from its _top-level_ options — with `undefined` if they
> are absent. Passing them only as `jsonWebTokenOptions`, which looks like the tidy way to
> share one object, silently switches issuer and audience checking off with no error. The
> rules are therefore spread at the top level, and two tests
> (`refuses a token from another issuer` / `… for another audience`) exist to catch a
> regression. See `doc/decision/0042-*`.

### 5. Becoming a user

`JwtStrategy.validate()` passes the parsed claims to `AuthUserService.resolve()`. See
_Just-in-time provisioning_ below. The result is an `AuthenticatedUser`, which Passport puts
on `request.user` and `@CurrentUser()` hands to a handler.

`AuthenticatedUser` is a strict subset of the row: `id`, `oktaId`, `email`, `name`, `role`,
`active`. It deliberately carries **no `icsToken`** — that is the only credential on the
personal calendar feed URL and nothing outside the ICS and settings handlers has any business
holding it.

### 6. What comes back on failure

| situation                                                                                 | status  | body                                                                        |
| ----------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| no header, bad signature, expired, wrong `iss`/`aud`, unknown `kid`, unreachable IdP      | **401** | `{ statusCode: 401, message: … }` — Nest's transport shape, **no `code` field** |
| `User.active === false`                                                                   | **403** | `{ defined: false, code: 'FORBIDDEN', status: 403, message: … }`            |
| `@Roles('ADMIN')` reached by a `USER`                                                     | **403** | same as above                                                               |

The split is deliberate and is written up in `doc/decision/0041-*`. In short: an
authentication failure happens before any procedure exists, so it cannot be one of the
contract's typed errors; a deactivated user, by contrast, presented a perfectly valid token
and answering 401 would send them round the Okta login loop forever.

Stack traces are logged and never sent — that is `ContractExceptionFilter`'s job and is
unchanged by this layer. No log line in `src/auth/**` carries a raw token, a key, or an
`icsToken`, and `buildLoggerOptions` already redacts the `authorization` header.

---

## Environment

Five variables. The four read by `apps/garage/web` are validated fail-fast in `apps/garage/web/src/env.ts`;
`AUTH_OKTA_AUDIENCE` belongs to `apps/garage/api`'s schema. `.env.example` documents all of them.

| variable                 | read by                | used for                                                                                                                                         |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_SECRET`            | `apps/garage/web`             | encrypts the Auth.js session cookie. ≥ 32 characters.                                                                                            |
| `AUTH_OKTA_ISSUER`       | `apps/garage/web`, `apps/garage/api` | the OIDC issuer, shared verbatim by both halves. `apps/garage/web` discovers the authorization and token endpoints from it; `apps/garage/api` discovers the JWKS URI from the same document. |
| `AUTH_OKTA_AUDIENCE`     | `apps/garage/api`             | the `aud` every bearer must carry. See _The audience the two halves agree on_.                                                                    |
| `AUTH_OKTA_CLIENT_ID`    | `apps/garage/web`             | the web app's OAuth2 client.                                                                                                                     |
| `AUTH_OKTA_CLIENT_SECRET`| `apps/garage/web`             | its secret. Server-side only.                                                                                                                    |

There is deliberately **no** `AUTH_TRUST_HOST`, and that absence is load-bearing. Auth.js
refuses to serve `/api/auth/*` at all unless `trustHost` is true, and computes it as
`!!(AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? CF_PAGES ?? NODE_ENV !== 'production')`. This
deployment sets none of the first four and runs `NODE_ENV=production`, so the inherited
default would be `false` **in production and nowhere else** — dev and e2e stay green for
free, and the first real deploy would answer every `/api/auth/*` request with
`UntrustedHost: Host must be trusted`. `createAuthConfig` therefore states `trustHost: true`
outright: it is a property of the deployment topology (single instance, one reverse proxy in
front), not of an environment, and adding a sixth variable would put the decision back in the
place this lib's rules keep it out of. `create-auth.spec.ts` drives the real route handler
under `NODE_ENV=production` with all four web variables removed and asserts a 200.

`AUTH_OKTA_ISSUER` is the **only** Okta URL anywhere in the configuration. The authorization
and token endpoints are discovered from `${issuer}/.well-known/openid-configuration`
(`doc/decision/0045-*`), and so is the JWKS URI `apps/garage/api` verifies against
(`doc/decision/0043-*`). In dev and e2e the value points at the `mock-oauth2-server`
container; in production at the real org.

The two secrets are read from `process.env` in `apps/garage/web` and passed to `createAuth` as
arguments. `libs/garage/auth` reads no environment variable of its own — Auth.js's implicit
`AUTH_SECRET` / `AUTH_OKTA_ID` / `AUTH_OKTA_SECRET` inference is deliberately bypassed so that
`apps/garage/web/src/env.ts` stays the one schema that decides which variables exist. Neither secret
carries a `NEXT_PUBLIC_` prefix, which is the only thing that would put it in the browser
bundle.

### What the Okta org has to be configured to do

Three settings live in the identity provider, not in this repo, and nothing here can enforce
them. An operator provisioning the org needs all three:

1. **Redirect URI.** `https://<host>/api/auth/callback/okta` must be registered. The path is
   derived from the provider id, which is why `OKTA_PROVIDER_ID` is a constant and not a
   literal.
2. **A Custom Authorization Server as the issuer**, so that the `aud` it mints is one
   `AUTH_OKTA_AUDIENCE` can be set to. See the next section.
3. **Refresh-token rotation switched off**, until a `LockService` exists. Concurrent
   refreshes are coalesced **in-process only**, so with rotation on, a second process or
   instance renewing at the same moment signs the user out. `doc/decision/0051-*` records the
   race and the upgrade path; _Concurrent renewals_ below explains it.

## The audience the two halves agree on

`apps/garage/api` validates the bearer against `AUTH_OKTA_AUDIENCE` and rejects any token whose `aud`
differs. `libs/garage/auth` sends **no** `audience` and no `resource` parameter, at `/authorize` or
at `/token`, so whatever `aud` ends up in the token is entirely the issuer's choice. That
makes `AUTH_OKTA_AUDIENCE` a value that has to match the issuer, not a value the two halves
can be assumed to share.

### Dev and e2e: `default` — observed

This half has been measured, not reasoned. With the Docker daemon running and
`mock-oauth2-server` up from `docker-compose.yml`, a token request against its `default`
issuer returned an access token whose decoded claims read
`{"sub":"garage-web","aud":"default","iss":"http://localhost:8080/default","tid":"default",…}`.
A reviewer independently drove a full `authorization_code` exchange plus a refresh against the
same container and decoded three separate access tokens; `aud` was `default` in every one.
That is what `.env.example` sets `AUTH_OKTA_AUDIENCE` to for dev and e2e, so the two halves
agree there.

The mechanism behind the observation: the container starts with no `JSON_CONFIG`, so its
`DefaultOAuth2TokenCallback` decides the audience in this order — configured audience, then
the request's `audience` parameter, then the token request's non-OIDC scopes, else its
built-in `default`. There is no configured audience, we send no `audience` parameter, and
Auth.js v5's code exchange sends no `scope` on the token request at all (our refresh POST
sends only `grant_type` and `refresh_token`). Even a scope-bearing request would come out
empty, because the callback filters against Nimbus's `OIDCScopeValue`, which covers `openid`,
`profile`, `email` **and** `offline_access` — every scope we ask for. The last branch applies,
which is what the decoded tokens show.

### Production: the issuer must be a Custom Authorization Server — a prediction

This half is **reasoning, not measurement**: there is no Okta tenant to point at, so no token
minted by the real org has been decoded.

A Custom AS (`https://<org>.okta.com/oauth2/<id>`, e.g. `/oauth2/default`) mints access tokens
whose `aud` is that server's configured audience — `api://default` for Okta's built-in one,
which is what `AUTH_OKTA_AUDIENCE` should be set to there. Point `AUTH_OKTA_ISSUER` at the
**Org** Authorization Server instead (`https://<org>.okta.com`, no `/oauth2/...`) and `aud`
becomes the org URL, so the two halves stop agreeing — in production only. That is the silent
precondition on this variable, and the reason "which issuer URL" is an auth decision rather
than a copy-paste.

**The symptom, if it is got wrong:** sign-in itself succeeds, and then every API call and
every Socket.io handshake answers 401 with `JsonWebTokenError: jwt audience invalid`. Task
11's own diagnostic advice — "compare `AUTH_OKTA_AUDIENCE` against the `aud` your IdP actually
mints" — is exactly this check.

**What would settle it:** an end-to-end sign-in against a real Okta org, with one access token
decoded and its `aud` read. Task 28's Playwright login flow is the first thing in this build
that drives a real OIDC redirect end to end; pointed at a real tenant, it answers the question,
and this section should then be rewritten with the value it found. If the value turns out to be
wrong, the fix stays in `.env.example` — no code changes, which is what keeps "same code, only
env values differ" true.

## What the browser can see

| value                             | lives in                                              | reaches the browser? |
| --------------------------------- | ----------------------------------------------------- | -------------------- |
| refresh token                     | the encrypted httpOnly session cookie                 | **no**               |
| access token                      | that cookie, and React state after `/api/auth/session` | yes, in memory only  |
| `AUTH_SECRET`, client secret      | `process.env`, server only                            | **no**               |

Nothing is written to `localStorage`, `sessionStorage`, or a JS-readable cookie. The browser
needs the access token because `libs/garage/realtime-client` (Task 21) puts it in the Socket.io
handshake; the refresh token it has no use for, and never receives. Reasoning and how it is
tested: `doc/decision/0047-*`.

## Refresh token rotation

`offline_access` is requested at sign-in — without it Okta issues no refresh token at all and
the session would die with the first access token.

Rotation lives in the `jwt` callback:

1. **At sign-in**, `account.access_token` / `expires_at` / `refresh_token` are copied onto the
   JWT.
2. **On every later session read**, a token more than 60 s (`REFRESH_SKEW_SECONDS`) from
   expiry is returned untouched.
3. **Inside that window**, the refresh token is exchanged at the discovered token endpoint.
   Renewing _before_ expiry rather than at it is what stops the renewed request from racing
   the old token's `exp`.
4. **On failure**, the access and refresh tokens are dropped and `error: 'RefreshTokenError'`
   is set. The session is not retried while that flag is present.

A tab sitting idle re-reads `/api/auth/session` every 300 s (`SESSION_REFETCH_SECONDS`), which
is what makes step 3 fire at all — the callback only runs when something asks for the session.
See `doc/decision/0049-*`.

### Concurrent renewals

One page load reads the session more than once — a root layout, a Server Component and a Route
Handler each calling `await auth()`, plus the browser's poll. If they land inside the same
renewal window they all hold the same refresh token, and with rotation enabled the first grant
invalidates it under the others: they get `invalid_grant`, the session fails closed, and the
user is signed out mid-session for no visible reason.

Callers presenting the same refresh token therefore share a single in-flight grant. That
covers every caller in one process, which is the whole single-instance deployment. It does
**not** cover several processes or instances — that needs the `LockService` abstraction
`plan.md` mandates, and until it exists **Okta refresh-token rotation must stay switched off**
on the authorization server, which turns the remaining races into a redundant grant rather
than a sign-out. Nothing in this repo enforces that setting, which is why it is also listed
under _What the Okta org has to be configured to do_ above; `doc/decision/0051-*` records the
race, the residual cases and the upgrade path.

### When it fails

Not a silent 401. Three things happen, in the three places they have to:

- `getAccessToken()` returns `null`, so `createApiClient` omits the `Authorization` header
  entirely — the API answers "unauthenticated" rather than rejecting a stale token;
- `callbacks.authorized` returns `false`, so the middleware redirects the next navigation to
  the sign-in page;
- `useRequireAuth()` calls `signOut()`, clearing the dead cookie rather than signing in on top
  of it.

`doc/decision/0048-*` covers why sign-out rather than a retry or a forced `signIn`.

---

## Signing out

Sign-out does two things, and only the second one is load-bearing:

1. Auth.js clears the session cookie, as it always has.
2. **The server adds that session's subject to a revoked set**, and every later session read
   refuses a token carrying it.

The second exists because the first cannot be relied on. Under `strategy: 'jwt'` the session
lives in the cookie, and Auth.js re-issues that cookie on **every** request that reads the
session — a page render, an RSC prefetch, the proxy's own check. A single navigation to `/`
was measured setting three different session cookies, one per request. So the clearing
`Set-Cookie` from `POST /api/auth/signout` is racing every render that was already in flight,
and the browser keeps whichever arrives last. Under load, sometimes it is not the clear.

The application cannot fix that by ordering — it does not decide when Next.js prefetches, and
it cannot recall a response already sent — so it makes the surviving token useless instead.
`doc/decision/0230-*` has the measurements and the alternatives that were rejected.

### How revocation works

`libs/garage/auth/src/lib/revocation.ts`. On `events.signOut` the session's `sub` goes into a revoked
set; in the `jwt` callback, a token whose `sub` is in that set makes the callback return
`null`. Two things follow from that `null`, both from `@auth/core`:

- `auth()` yields no session, so `callbacks.authorized` is `false` and the proxy redirects the
  navigation to `/login`;
- the response **clears the session cookie** rather than re-issuing it — so a cookie that
  survived the race deletes itself the first time it is used.

The key is `sub`, and the reason it works is that **`sub` is not a per-person id**. `@auth/core`
sets the user id to a fresh `crypto.randomUUID()` on every completed sign-in, ignoring the
provider's profile id, and copies it to `token.sub`. So `sub` names one *sign-in session*:

- revoking it ends exactly the session that signed out, and no other device or later sign-in;
- re-encoding a session's cookie never changes it, so the token a racing render re-installs is
  refused on a value the race cannot move;
- signing out and back in needs no special case — the new session is a subject the set has
  never seen.

Nothing compares clocks. An earlier design keyed on `sub` plus an `iat` cutoff and was unsound:
`iat` is stamped at *encode* time, and a token refresh can run between the revocation check and
that encode, so a racing render could emit a later `iat` than the cutoff and be honoured. A set
has no window to lose. The clock survives only as retention — an entry is dropped once the token
it refuses could no longer be valid anyway.

A token with no `sub` is refused outright: the registry cannot key it, so it could never clear
it, and `isAuthorized` would not catch it either (it reads `auth.user`, never `sub`).
`@auth/core` always sets one, so this is unreachable in practice.

### What it does not cover

- **The Okta access token is not revoked at the issuer.** Anyone holding a copy of it can keep
  calling `apps/garage/api` directly until it expires — measured at one hour against the dev issuer,
  and set on the Okta authorization server in production, which this repository does not
  configure. Named as a deliberate boundary in `doc/decision/0230-*`.
- **The revoked set is in memory**, shared across Next.js's bundles via `globalThis`
  (`doc/decision/0231-*` — and it is not optional; a module-level map silently does nothing,
  which is why it now refuses to boot on the Edge runtime rather than quietly not enforcing).
  A restart forgets it, and a second web instance would not see the first's sign-outs.

---

## Diagnosing a 401

Every rejection above reaches the caller as the same bare 401. That is deliberate — telling
an anonymous caller _why_ their token was refused is telling an attacker which half of the
forgery to fix. It does mean the response is useless for diagnosis, so **the logs carry the
diagnosis instead**.

`JwksVerifierService` classifies every key-lookup failure and logs it with an `authFailure`
field. Search for that field first:

| `authFailure`           | level   | what it means                                                                                                                                          | what to do                                                                                                                             |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `issuer-unreachable`    | `error` | the discovery endpoint did not answer, or answered non-2xx                                                                                             | is the IdP up? is `AUTH_OKTA_ISSUER` reachable from the API host?                                                                       |
| `discovery-rejected`    | `error` | it answered, and we refused the document — the `issuer` it declares does not match `AUTH_OKTA_ISSUER`, or `jwks_uri` is on another origin              | `AUTH_OKTA_ISSUER` is pointing at the wrong tenant, or the document is not what it should be. The `reason` field names which check failed |
| `jwks-unavailable`      | `error` | discovery worked, fetching the keys did not                                                                                                            | usually a partial IdP outage                                                                                                           |
| `jwks-rate-limited`     | `error` | more than 12 JWKS fetches in a minute                                                                                                                  | almost always a flood of tokens with unknown `kid`s; check who is calling                                                              |
| `signing-key-not-found` | `debug` | the JWKS was fetched and has no key with this `kid`                                                                                                    | normally somebody else's token. If it is happening to _everyone_, the IdP rotated to a key it is not publishing                        |
| `malformed-token`       | `debug` | not a JWT, or an algorithm we do not accept                                                                                                            | normally background noise on a public endpoint                                                                                         |

Two other 401s do **not** come from that table, because they happen after a key was found:

- **`jsonwebtoken` rejected the token** — bad signature, expired, wrong `iss`, wrong `aud`.
  These are normal and are not logged individually; a request-id'd 401 in the access log is
  all there is. If _nobody_ can log in and there is no `authFailure` line, this is where to
  look: compare `AUTH_OKTA_AUDIENCE` against the `aud` your IdP actually mints.
- **A valid token with no `email` claim, for a subject that is not yet provisioned.** Logged
  by `AuthUserService` at `error`: _"Token carries no email claim and the subject is not
  provisioned; check the IdP scopes"_. This is the first thing to check on a fresh dev
  environment.

### Why the levels are what they are

The four server-side kinds are `error`: nobody can log in and every one of them needs a
human. `discovery-rejected` in particular is a permanent misconfiguration that will never
heal on its own. Splitting the four across `warn` and `error` would mean an operator has to
know which is which before they can find any of them.

The two caller-side kinds are `debug`. A malformed bearer token and a `kid` from another
issuer are what a public endpoint receives all day; nobody acts on them, and at the default
`LOG_LEVEL=info` they cost nothing. Logging them at `warn` would also hand an anonymous
caller a cheap way to fill the log — the same reasoning `ContractExceptionFilter` already
applies to an oversized request body.

### Why an outage does not flood the log

An IdP outage sends **every** request down this path, so one line per request would be a
flood — expensive, and it buries the one line that mattered. `FailureLogThrottle` emits the
first occurrence of each kind immediately, then stays quiet for 60 seconds, counting what it
swallowed and attaching the count to the next line that gets through:

```
ERROR  Cannot verify tokens — the issuer or its JWKS is unusable
       authFailure=issuer-unreachable issuer=https://acme.okta.com/oauth2/default
       reason="OIDC discovery at … could not be reached: fetch failed"
       suppressedSinceLastLog=4126
```

So an operator sees both the cause and the blast radius. The throttle is keyed by failure
kind only — never by a `kid`, an issuer or a subject — so its map is bounded at six entries
and cannot be grown by a caller. A `kid` is reported _inside_ a line, truncated to 64
characters, but never used as a key.

No `Error` object is logged, only its message. A stack adds nothing actionable here and
would be repeated every minute for the length of an outage; this follows the call
`doc/decision/0035-*` made for the readiness probe.

---

## Public routes

`@Public()` marks a route reachable without a token. It is route metadata evaluated
identically in every environment — not an environment branch. It exists for the two kinds of
route that genuinely cannot carry an `Authorization` header:

- **the health probes** (`HealthController`). An orchestrator has no bearer token and no way
  to get one; authenticating the probes would report every healthy instance as dead. The
  probes expose no data — liveness returns a constant, readiness returns up/down plus a fixed
  reason string. They answer at `/health/live` and `/health/ready`: `configureApp()` passes
  both to `setGlobalPrefix`'s `exclude`, so they are **not** under `/api/health/*`.
- **the personal ICS feed** (Task 12). Calendar clients fetch it with no headers at all; it
  authenticates on the secret in its own URL and should also carry `@StrictThrottle()`.

A `@Public()` route gets **no** `request.user`. `RolesGuard` fails closed on that, so
`@Public()` next to `@Roles('ADMIN')` denies rather than allows, and `@CurrentUser()` throws
rather than handing a handler `undefined`.

---

## Just-in-time provisioning

There is no sign-up screen. On somebody's first ever request, `AuthUserService.resolve()`:

1. matches on `oktaId` (the token's `sub`) — the provisioning key;
2. failing that, matches on `email`, and **adopts the token's `sub` onto that row**. This
   covers a row seeded ahead of a first login and an Okta account that was deleted and
   recreated. It is logged at `warn` with the old and new `oktaId`;
3. failing that, creates the row with a fresh `icsToken` from `crypto.randomBytes(32)`,
   `base64url`-encoded.

Then `active === false` → `FORBIDDEN`.

Two further rules:

- A valid token with **no `email` claim**, for a `sub` that is not yet provisioned, is
  refused with 401 and an `error`-level log. That condition means the IdP client is missing
  the `email` scope; no placeholder address is invented.
- `email` is never refreshed from the token (it is the fallback identity key). `name` is,
  and only when it differs — so the steady-state request performs no write.

### Concurrency

A browser opens several requests at once, so "first request ever" is routinely several first
requests at once. There is no application lock — the MVP is single-instance with no Redis by
design. The database settles it: `oktaId`, `email` and `icsToken` are all `@unique`, so the
loser of the race gets `P2002`, which `AuthUserService` catches and retries (up to three
attempts), at which point the re-read finds the winner's row. Every caller gets the same row
and none of them sees an error.

Full reasoning and the risk of the email rebind: `doc/decision/0044-*`.

---

## Discovery and key rotation

### Where the keys come from

`AUTH_OKTA_ISSUER` is the only thing configured. On the first token to be verified, the
service fetches `${AUTH_OKTA_ISSUER}/.well-known/openid-configuration` and takes `jwks_uri`
from it. Okta publishes at `${issuer}/v1/keys`, `mock-oauth2-server` at `${issuer}/jwks` — a
hardcoded suffix would work in exactly one of them.

The document is checked, not just parsed:

- its own `issuer` must equal `AUTH_OKTA_ISSUER` (trailing slashes normalised), so a
  misconfigured issuer fails loudly rather than validating against another tenant's keys;
- `jwks_uri` must be on the **same origin** as the issuer, so a tampered document cannot
  point key selection at a third party.

Discovery is lazy — resolving it in the constructor would make the process refuse to boot
during an IdP blip — and memoised. **A failed discovery drops the memo**, so the next request
retries instead of every later request inheriting one rejected promise.

### What happens when a key rotates

Nothing operational. No restart, no config change, no waiting for a TTL.

`jwks-rsa` memoises signing keys **per `kid`** and does not cache failures. When the IdP
starts signing with a new key, the first token carrying the new `kid` is a cache miss, which
triggers an immediate refetch of the JWKS — and the freshly published key is there. The key
is picked up by that first request.

Nothing on the frontend is affected either: `libs/garage/auth` never validates a token, it only
carries one.

The 10-minute `cacheMaxAge` therefore does not govern rotation. It bounds something else: how
long a key that has been _withdrawn_ from the JWKS can still be used, if it is already in the
cache.

Cache and fetch settings (constants in `jwks-verifier.service.ts`):

| setting                                  | value       | why                                                                                                                                    |
| ---------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `cache`                                  | `true`      | one JWKS fetch per key, not per request                                                                                                |
| `cacheMaxAge`                            | 10 min      | bounds a withdrawn key's usable lifetime                                                                                               |
| `cacheMaxEntries`                        | 5           | an issuer publishes a handful of keys at most                                                                                          |
| `rateLimit` / `jwksRequestsPerMinute`    | `true` / 12 | an unknown `kid` is a cache miss, so random `kid`s would otherwise let an anonymous caller make the API hammer the IdP                  |
| `timeout`                                | 5 s         | an unreachable IdP fails the request quickly                                                                                           |
| `cacheMaxAgeFallback`                    | **unset**   | see below                                                                                                                              |

### Why a cache miss can never become a bypass

`jwks-rsa` offers `cacheMaxAgeFallback`: keep serving the last known good key while the JWKS
endpoint is unreachable. It is deliberately **not enabled**. That window is precisely the
window in which a key that was just revoked — because it leaked — continues to be trusted,
and an attacker who can also make the endpoint unreachable controls how long it lasts.

So an IdP outage means requests are **rejected**, not waved through. Every failure path in
`JwksVerifierService` throws. When the rate limit is hit, `jwks-rsa` raises and the request is
refused. The cost — some logins fail during an IdP outage or a `kid` flood — is the correct
trade, and `doc/decision/0043-*` records it so nobody "fixes" it later without reading why.

---

## Using it from the app

Server side:

```ts
// apps/garage/web/src/auth.ts
export const { handlers, auth, signIn, signOut, getAccessToken } = createAuth({ … });

// app/api/auth/[...nextauth]/route.ts
export const { GET, POST } = handlers;

// middleware.ts
export { auth as middleware } from './src/auth';

// any Server Component / Route Handler / Server Action
const session = await auth();
const api = createApiClient({ url: apiRpcUrl(env.NEXT_PUBLIC_API_URL), getAccessToken });
```

`apiRpcUrl` — `apps/garage/web/src/api-url.ts` — is not decoration. `NEXT_PUBLIC_API_URL`
stops at the global prefix (`http://localhost:3000/api`), while the oRPC
transport is mounted a segment below it (`MeController` is `@Controller('rpc')`),
and `RPCLink` appends only the procedure's key path to the base it is given.
Passing the configured URL straight in calls `POST /api/me/get`, which **404s —
every request**, measured against the running API. Use the helper; the same file
derives the readiness-probe URL and the Socket.io origin, which are not the base
URL either. See `doc/decision/0101-*`.

Browser side:

```tsx
'use client';
import { AuthProvider, useRequireAuth, useAccessTokenProvider } from '@garage/auth/client';

// in the app's provider boundary, with the server-read session handed down:
<AuthProvider session={session}>…</AuthProvider>

// in a protected screen:
const { session, status } = useRequireAuth();

// to give a transport its token:
const getAccessToken = useAccessTokenProvider();   // stable identity, latest session
```

`@garage/auth` and `@garage/auth/client` are separate entry points on purpose: the
server half pulls in Auth.js's route handlers and `next/server`, which have no place in a
browser bundle (`doc/decision/0046-*`). A Jest guard fails the build if the client entry ever
reaches the server modules.

## Adding an authenticated route

```ts
@Controller('spots')
export class SpotsController {
  // Authenticated by default. Nothing to add.
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) { … }

  // Admin only.
  @Roles('ADMIN')
  @Post()
  create(@CurrentUser() admin: AuthenticatedUser) { … }
}
```

And the rarer case:

```ts
// No token; authenticates on the secret in its own URL. Pair with the
// stricter rate-limit tier, because it is reachable without a session.
@Public()
@StrictThrottle()
@Get('ics/:token')
feed(@Param('token') token: string) { … }
```

`@Roles()` takes the contract's `UserRole`, so a typo does not compile.

---

## How this is tested

Four levels, none of which needs Docker.

**Against a real OIDC issuer.** `apps/garage/api/src/auth/testing/oidc-test-issuer.ts` is an
in-process HTTP server that serves a genuine discovery document and a genuine JWKS of real
2048-bit RSA public keys; the tests sign real RS256 tokens against it. Nothing is stubbed —
signature checking, discovery, caching and rotation are executed, not described. It stands in
for `mock-oauth2-server` at the same two endpoints, and it publishes its JWKS at `/jwks`
specifically so that a reintroduced hardcoded Okta path would fail the suite.

**Through the assembled application.** `auth-pipeline.spec.ts` boots the **real `AppModule`**
with the same `configureApp()` that `main.ts` calls, listens on an ephemeral port and drives
it with `fetch`. That is the only way to observe the properties that matter here — that
issuer and audience are genuinely checked, that a deactivated user gets 403 and not 401, that
an undecorated route is protected, that the probes stay reachable — because all of them are
properties of a composition (Express → throttler → guard → Passport → `jsonwebtoken` →
filter) rather than of any single function.

**The frontend half.** `libs/garage/auth`'s own unit tests stub only `fetch` (`AuthOptions.fetch`,
the same seam `ApiClientOptions.fetch` already is) and drive the real callbacks, the real
`SessionProvider`, and a real `createApiClient`. The end-to-end path through a browser is
Playwright's job in Fáze 7.

**Mutation-checked.** Four deliberate defects were introduced and reverted, to confirm the
suite can actually fail:

| defect introduced                                                        | tests that failed                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| rules passed as `jsonWebTokenOptions` (the `passport-jwt` trap)          | wrong issuer, wrong audience                                         |
| deactivated user throws `UnauthorizedException` instead of `DomainError` | the two unit assertions and the pipeline's 403-body assertion        |
| the P2002 provisioning retry removed                                     | both unit concurrency tests, and the HTTP one                        |
| `JwtAuthGuard` defaults to allow instead of deny                         | 15 of 20 pipeline tests                                              |
| failure reporting removed from `getSigningKey`                           | 7 of the 8 diagnosability tests                                      |
| the log throttle's interval reduced to zero                              | 3 throttle tests and the "one line, not 25" test                     |

The third of those found a real weakness in the test suite rather than in the code: the
HTTP-level concurrency test initially passed _with the retry deleted_, because each `fetch`
costs enough event-loop time that the first request finished provisioning before the second
had read. The store's insert is now held open so the six requests genuinely race.

### Against the mock OIDC server

`docker-compose.yml` runs `mock-oauth2-server`, and `AUTH_OKTA_ISSUER` in `.env.example`
points at its `default` issuer. It accepts any `client_id`/`client_secret`, serves a real
discovery document, and issues real signed JWTs, so the whole flow above is meant to run
unmodified — including refresh, because `libs/garage/auth` reads the client-authentication method out
of the discovery document rather than assuming one (`doc/decision/0045-*`).

The container has since been brought up, which answered the `aud` question above. One thing it
has not answered: which value of `token_endpoint_auth_methods_supported` the container
publishes, and therefore which of `libs/garage/auth`'s three client-authentication branches is taken
against it. All three are tested against a stubbed document; the live selection is unobserved.

### What is **not** covered here

- **No real Postgres.** The unique constraints are modelled by
  `testing/in-memory-user-store.ts`, which raises a genuine
  `Prisma.PrismaClientKnownRequestError` P2002 with the `meta.target` Postgres produces. The
  retry logic and the outcome are exercised; that Postgres raises P2002 for these particular
  indexes is inherited from `schema.prisma` and verified in CI.
- **No real `mock-oauth2-server` in the suites.** The protocol is exercised, that container's
  exact discovery document and default claim set are not. In particular, the claims captured
  while checking `aud` do not settle whether the container's tokens carry an `email` claim —
  so on the first `docker compose up`, **check for one**: without it, a first-time dev login
  hits the "no email claim" 401 until the client requests the `email` scope.
- **No real Okta tenant.** Everything specific to the production org — the Custom-vs-Org
  audience above, the refresh-token-rotation setting, key rotation against a live IdP — is
  derived from Okta's documentation and has been reasoned rather than run.

---

## For Task 15 (Socket.io)

`AuthModule` exports `JwksVerifierService` and `AuthUserService`. A WebSocket handshake
cannot run a Passport HTTP strategy, so the gateway should call
`JwksVerifierService.verifyToken(raw)` and then `AuthUserService.resolve(claims)` — reusing
this process's single JWKS client and the identical verification rules and provisioning path.

Do **not** construct a second `JwksClient` (or reach for `jwksRsa.passportJwtSecret()`): two
caches means two rotation moments and two rate limiters, so a key rotation could be visible
over HTTP and not yet over WebSocket. `doc/decision/0042-*` explains it.
