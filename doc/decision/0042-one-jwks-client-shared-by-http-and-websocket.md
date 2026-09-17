# 0042 – One JWKS client and one rule set, shared by the HTTP guard and the WebSocket handshake

**Date:** 2026-09-02 · **Status:** accepted · **Applies to:** Task 11, and Task 15 which
consumes it

## What

Token verification lives in `JwksVerifierService` (`apps/garage/api/src/auth/jwks-verifier.service.ts`),
not in the Passport strategy. The service owns:

- **one** `jwks-rsa` `JwksClient` for the process — one key cache, one rate limiter, one
  rotation behaviour;
- **one** rule set, `JwtVerificationRules` from `jwt-verify-options.ts`
  (`algorithms: ['RS256']`, `issuer`, `audience`, `ignoreExpiration: false`).

Two callers use them:

- `JwtStrategy` (`passport-jwt`) passes `verifier.getSigningKey` as its
  `secretOrKeyProvider` and spreads **the verifier's own `options` object** into its
  strategy options;
- `JwksVerifierService.verifyToken(raw)` verifies end to end and returns parsed claims. Task
  15's Socket.io gateway calls this, because a Passport HTTP strategy cannot run on a
  WebSocket handshake.

`AuthModule` exports `JwksVerifierService` and `AuthUserService` for that reason.

**`jwksRsa.passportJwtSecret()` is deliberately not used.**

## Why

**Why not `passportJwtSecret()`, the documented one-liner.** It constructs its own
`JwksClient` internally. Using it would leave the process with two key caches: the strategy's,
built by `jwks-rsa` with whatever options were passed at that call site, and the one the
WebSocket path needs. Two caches means two TTLs, two rate limiters and two rotation moments —
so a key rotation could be visible over HTTP and not yet over WebSocket, and the JWKS
flood-protection (`jwksRequestsPerMinute`) would have to be configured twice or would
silently protect only one transport. One client is not an optimisation here, it is the only
way the two paths can be said to behave the same.

**Why the rules are one object rather than one function called twice.** They are shared by
value, not by construction: `JwtStrategy` spreads `verifier.options`. A function called twice
with the same env would be *equivalent* today and is one edit away from not being.

**Why `JwtVerificationRules` is a narrow interface and not `jsonwebtoken`'s `VerifyOptions`.**
`VerifyOptions` has a dozen optional fields. Typing the shared object as the wide one would
let a future edit add `clockTolerance` or `ignoreNotBefore` on one path only, which is the
drift the shared object exists to prevent. The narrow interface has exactly four fields and
is structurally assignable to both `VerifyOptions` and `passport-jwt`'s
`BaseStrategyOptions`.

**Why `ignoreExpiration: false` is written out.** It is the default. It is also the one rule
whose accidental flip is invisible to every test that uses a fresh token, so it is stated
rather than assumed, and there is a dedicated expired-token test on both paths.

**Why no `clockTolerance`.** A tolerance is a window in which an expired token is still
accepted. This is a single-instance deployment on an NTP-synchronised host and there is no
observed skew problem to trade it for. If one appears, it is added here — once — and both
paths inherit it, which is the property this decision buys.

## How

The shape of `JwtVerificationRules` is dictated by a trap in `passport-jwt` 4.x. Its
constructor builds the options it hands to `jsonwebtoken`:

```js
this._verifOpts = assign({}, options.jsonWebTokenOptions, {
  audience: options.audience,
  issuer: options.issuer,
  algorithms: options.algorithms,
  ignoreExpiration: !!options.ignoreExpiration,
});
```

The four explicit keys **overwrite** whatever `jsonWebTokenOptions` contained — with
`undefined` when they were not also passed at the top level. So the obvious way to share one
options object,

```ts
super({ jwtFromRequest, secretOrKeyProvider, jsonWebTokenOptions: verifier.options })
```

**silently disables issuer and audience checking**, with no error, no warning, and a
configuration that reads as correct. The rules are therefore spread at the top level:

```ts
super({ jwtFromRequest, secretOrKeyProvider, ...verifier.options })
```

This was verified by mutation, not by reading: changing the spread to `jsonWebTokenOptions:`
makes exactly two tests fail — "refuses a token from another issuer" and "refuses a token for
another audience" — and the other 18 in `auth-pipeline.spec.ts` still pass. Without those two
tests the mistake is invisible.

Client options, all constants in `jwks-verifier.service.ts` with their reasoning inline:
`cache: true`, `cacheMaxAge: 600_000`, `cacheMaxEntries: 5`, `rateLimit: true`,
`jwksRequestsPerMinute: 12`, `timeout: 5_000`.

## Risk if this is wrong

**A second `JwksClient` appearing later.** Task 15 is the immediate candidate: the easy way
to authenticate a Socket.io handshake is to reach for `jwks-rsa` again. `AuthModule` exports
the service precisely so that the easy path is the correct one, and the exports carry a
comment saying why.

**The `passport-jwt` trap reappearing.** Any refactor that "tidies" the strategy options —
moving them under `jsonWebTokenOptions`, or passing `verifier.options` as a single named
option — re-opens it. The comment sits at both ends (the strategy and
`jwt-verify-options.ts`) and the two wrong-issuer/wrong-audience tests are the guard.

**The rate limit is a real, if remote, denial vector.** An unknown `kid` is a cache miss, so
an anonymous caller presenting tokens with random `kid`s makes the API fetch the JWKS.
`jwksRequestsPerMinute: 12` bounds that; when the limit is hit `jwks-rsa` raises, so requests
are **rejected** rather than let through. Under a sustained flood, legitimate first-time
logins with a genuinely new `kid` could be refused for up to a minute. That is the correct
trade — failing closed — but it is a real availability cost and is recorded here so nobody
"fixes" it by raising the limit without understanding what it protects.
