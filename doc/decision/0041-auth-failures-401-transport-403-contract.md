# 0041 – Authentication failure is a transport 401; a deactivated user is the contract's FORBIDDEN

**Date:** 2026-09-02 · **Status:** accepted · **Follows on from:** `doc/decision/0016-*`,
`doc/decision/0033-*`

## What

Task 11 introduces two kinds of rejection, and they deliberately do **not** share a shape.

1. **The caller could not be authenticated** – no `Authorization` header, a malformed
   bearer value, a bad signature, an expired token, the wrong `iss`, the wrong `aud`, an
   unknown `kid`, an unreachable JWKS endpoint. Result: **401** with Nest's transport shape,
   `{ statusCode: 401, message: 'Unauthorized' }`. There is **no** `code` field.
2. **The caller was authenticated and is not allowed** – `User.active === false` (how
   offboarding works), or a `@Roles('ADMIN')` route reached by a `USER`. Result: **403** with
   the contract shape,
   `{ defined: false, code: 'FORBIDDEN', status: 403, message: '…' }`.

**No new member was added to `ERROR_CODES`.** The closed enum stays exactly as Task 3 left
it. `FORBIDDEN` already exists and is already declared on *every* procedure by the `authed`
builder in `libs/garage/contract/src/api/errors.ts`, whose own comment says why: "a deactivated
user (`active: false`, how offboarding works) is rejected before any handler runs".

## Why

**Why authentication failure is not a contract code.** It happens in a guard, before any
oRPC procedure is entered. oRPC's typed errors are per-procedure declarations; an error
raised before the procedure exists cannot be one of them, and emitting `defined: false` with
an invented code would be claiming membership of an enum the contract does not grant. This is
the same reasoning `doc/decision/0033-*` already applied to an unmatched route, a throttled
request and an oversized body: transport-level failures keep Nest's shape because the closed
enum has no member for them, and the client distinguishes them by status.

**Why a deactivated user is not 401.** Because the token is *valid*. A 401 tells the browser
"your credentials are missing or stale, go and get new ones" — so `apps/garage/web` would send the
person to Okta, Okta would authenticate them happily and reissue an equally valid token, and
the API would answer 401 again. That is an infinite redirect loop, and the person would never
see an explanation. 403 with `code: 'FORBIDDEN'` is a code `libs/shared/i18n` can key Czech copy
off, which is the entire point of having a closed enum.

**Why not add `UNAUTHORIZED` to the enum anyway, for symmetry.** Symmetry is not the goal;
the enum's job is to enumerate the outcomes a *procedure* can produce so that the frontend's
handling is exhaustive. Adding a code that no procedure declares and no handler throws is the
mistake `doc/decision/0021-*` names ("a declared error must have a reachable trigger"), run
in reverse. It would also force `apps/garage/web` to handle a code that can never appear in a
successfully-routed response.

**Why "no `code` field" is stated as a requirement and asserted in a test.**
`doc/decision/0033-*` closes with exactly this risk: if someone added `code` to the transport
branch "for consistency", the frontend would treat it as a member of `ERROR_CODES` and hit a
value the enum does not know. `auth-pipeline.spec.ts` therefore asserts
`expect(body).not.toHaveProperty('code')` on every one of the eight 401 cases.

## How

The split is not implemented by branching on a status. It falls out of which of Passport's
two legs an error travels, and that is a property of three libraries composed:

- `passport-jwt` calls `strategy.fail(info)` when `jsonwebtoken.verify` rejects. Nest's
  `AuthGuard.handleRequest` sees `user === false` and throws `UnauthorizedException` → 401,
  transport shape via `ContractExceptionFilter`'s `HttpException` branch.
- `@nestjs/passport`'s `PassportStrategy` mixin catches a **rejected** `validate()` and
  calls `done(err)`, which is `strategy.error(err)`. Nest rethrows that error unchanged, so
  `AuthUserService`'s `DomainError('FORBIDDEN')` reaches the filter's `DomainError` branch →
  403, contract shape.

`JwtAuthGuard` therefore **does not override `handleRequest`**. Overriding it to "improve the
message" is precisely how this distinction gets lost, and the class comment says so.

`RolesGuard` throws the same `DomainError('FORBIDDEN')` for a role mismatch, so from the
client's point of view "you were offboarded" and "you are not an admin" are one situation:
correctly identified, not allowed.

## Risk if this is wrong

**The 403 path is the fragile one.** It depends on `@nestjs/passport` continuing to route a
rejected `validate()` through `error()` rather than `fail()`. Nothing in this repository
controls that, and a minor-version change to `@nestjs/passport` could flip a deactivated
user's response to 401 with no compilation error and no test failure anywhere that stubs the
guard. That is why the assertion lives in `auth-pipeline.spec.ts` against a **running
server** and pins the exact body, and why it was verified by mutation: replacing the
`DomainError` with an `UnauthorizedException` fails three tests, so the assertion is known to
be capable of failing.

**`@nestjs/passport` is therefore pinned exactly** — `"12.0.0"`, not `"^12.0.0"` — in
`package.json`. A caret range is precisely how that behaviour change arrives unannounced, on
somebody else's `npm install`, in a task that has nothing to do with auth. Pinning does not
prevent the change; it makes it a deliberate act with a diff to review. The reasoning is
repeated in the class comment of `apps/garage/api/src/auth/jwt-auth.guard.ts`, because that is where
someone puzzled by the pin will actually be reading. When the pin is lifted, run
`auth-pipeline.spec.ts` before anything else.

The second risk is a well-meant "unify the error shapes" refactor. If a future task makes the
401 branch emit `{ defined: false, code: … }`, `apps/garage/web` will switch on a code that
`errorCodeSchema` rejects. The transport body must stay without `code`.
