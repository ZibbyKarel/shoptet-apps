# 0044 – JIT provisioning matches on `oktaId`, falls back to `email`, and lets the database settle races

**Date:** 2026-09-02 · **Status:** accepted · **Follows on from:** `doc/decision/0027-*`,
`doc/decision/0032-*`

## What

There is no sign-up screen. `AuthUserService.resolve(claims)` turns a **verified** token
into a `User` row, in this order:

1. `findUnique({ oktaId: claims.sub })` — the provisioning key.
2. Otherwise `findUnique({ email: claims.email })`. On a hit, the row's `oktaId` is
   **overwritten** with the token's `sub`, and the rebind is logged at `warn` with both the
   old and the new value.
3. Otherwise create, with `icsToken = randomBytes(32).toString('base64url')`.

Then: `active === false` → `DomainError('FORBIDDEN')` (see `doc/decision/0041-*`).

Three further rules:

- A token with **no `email` claim** whose `sub` is not yet provisioned is refused with 401
  and an `error`-level log naming the missing IdP scope. No placeholder address is invented.
- `email` is **never** refreshed from the token. `name` is, and only when it differs, so the
  steady-state request is read-only.
- A `P2002` unique-constraint violation during step 2 or 3 is caught and the whole sequence
  is retried, up to `MAX_PROVISIONING_ATTEMPTS = 3`.

## Why

**Why `oktaId` and not `email` is the key.** `sub` is what the IdP guarantees stable for a
person. An email is a mutable label — a surname change, a domain migration — and keying
identity on it means a rename detaches somebody from their reservations and their audit-log
entries, which `doc/decision/0027-*` deliberately keeps forever.

**Why an email fallback exists at all.** Two cases `sub` alone cannot cover: a row seeded by
an admin ahead of somebody's first login, and an Okta account deleted and recreated (a new
`sub`, the same company address). Without the fallback the first produces a duplicate row
that violates `User_email_key` and hard-fails the login; the second silently orphans a
person from their own history.

**Why the rebind is acceptable, and what it assumes.** This deployment has exactly one
identity provider — the company's own Okta — which owns the address space and issues the
addresses. A token it signed, for our audience, saying "`sub` X has email alice@…" *is*
Alice. The rebind therefore does not widen trust beyond what verifying the signature already
established.

The assumption it rests on, stated plainly because it is the whole risk: **the IdP must not
let a user self-assert an unverified `email` claim.** If it did, anyone able to obtain a
token for our audience could set `email` to a colleague's address and take over their row,
including an `ADMIN` one. Okta does not do this for a company directory. Any future change of
IdP, or any addition of a second one, invalidates this decision and must revisit it.

**Why `email` is not refreshed from the token.** It is the fallback identity key in step 2.
Rewriting it from a claim would let an address change at the IdP silently move the match
target onto another row, and it is the one column here whose update can itself raise P2002.
Address changes are an admin operation.

**Why "no `email` claim" is 401 rather than 403.** The token is valid but does not identify a
*provisionable* person — the API cannot say who this is in its own terms. 403 would be worse:
`apps/garage/web` renders `FORBIDDEN` as "your account is not allowed", which would be a plainly
wrong explanation for a missing OAuth scope. The condition is an operator misconfiguration
(the client was not granted `email`), affects everybody at once, and the `error`-level log
says exactly that.

**Why a retry loop and not a lock.** A browser opens several requests at once, so "first
request ever" is routinely several first requests at once, and read-then-create lets two of
them both find nothing and both insert. The MVP is single-instance with no Redis and no
broker (`plan.md`), so an application-level lock would be both unavailable across processes
and unnecessary: `oktaId`, `email` and `icsToken` are all `@unique`, so the database already
rejects the loser with P2002. Catching it and re-reading is the whole mechanism. Bounded at
three attempts rather than `while (true)`, so a P2002 this code cannot resolve surfaces as an
error instead of a hang.

**Why 32 bytes for `icsToken`.** It is the *only* credential on the personal calendar-feed
URL — calendar clients cannot send an `Authorization` header — so it is a session-secret-grade
value, from `randomBytes` (CSPRNG), `base64url` because it is pasted into a URL path. It is
never returned to a caller: `AuthenticatedUser` omits it entirely.

## How

The concurrency claim is exercised, not asserted. `testing/in-memory-user-store.ts` enforces
all three unique constraints and raises a genuine
`Prisma.PrismaClientKnownRequestError` with `code: 'P2002'` and the `meta.target` Postgres
produces. Two levels of test:

- in-process: eight simultaneous `resolve()` calls create exactly one row and every caller
  receives the same `id`;
- over real HTTP: six simultaneous requests to a protected route, with the store's insert
  held open (`createDelayMs`) so that all six are genuinely inside `create` at once.

That second test needed the delay to be worth anything. Mutation testing found it: with the
P2002 retry deleted, the HTTP-level test still passed, because each `fetch` costs enough
event-loop time that the first request finished provisioning before the second had read — so
no race occurred and the assertion held however the code was written. With the delay, the
same mutation fails it.

## Risk if this is wrong

**The rebind is the sharp edge.** It is a write triggered by an email claim, and its safety
is entirely inherited from the IdP's guarantees about that claim. It is logged at `warn` with
both `oktaId` values so the event is greppable, but nothing *alerts* on it — and this project
has no alerting by scope decision. If the IdP assumption ever changes, the mitigation is to
require a verified-email claim (`email_verified`) or to drop step 2 and handle seeded rows by
seeding their real `sub`.

**Three attempts is a guess.** It comfortably covers the realistic case (a burst of parallel
first requests, where one retry already finds the winner) and the pathological one (a
`base64url` collision on 32 random bytes, which will not happen). A pathological P2002 the
code cannot resolve — for instance a future unique constraint added to `User` that
provisioning violates — will surface as a 500 after three round trips rather than being
retried forever. That is the intended failure mode.

**The unique constraints are modelled, not exercised, in these tests.** Docker was
unavailable when this was written, so that Postgres actually raises P2002 for
`User_oktaId_key` / `User_email_key` / `User_icsToken_key` is inherited from
`libs/garage/database/prisma/schema.prisma` and verified only in CI. The retry logic, the catch and
the "every caller gets the same row" outcome are genuinely exercised.
