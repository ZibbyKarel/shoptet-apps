# 0246 – A `globalThis` fix is only tested by loading two module registries

**Date:** 2026-09-03 · **Status:** accepted · **Task:** final-review fix round, shard contract-auth (I-1)
**Corrects:** `doc/decision/0231-*` § Risk, first bullet
**Applies to:** `doc/decision/0231-*` (revocations) and `doc/decision/0245-*` (refresh state)

## What

Every `globalThis` + `Symbol.for` store in `libs/garage/auth` gets one test that loads
the module **twice, into two independent module registries**, via
`jest.isolateModules`, and asserts the two loads see the same object.

`revocation.spec.ts` › *hands the same map to two independent module registries*
`refresh.spec.ts` › *hands the same state to two independent module registries*

## Why

`0231-*` claimed:

> Two tests hold the line: `revocation.spec.ts` › *refuses to boot on the Edge
> runtime…*, and `config.spec.ts` › *revokes across configurations, not just the
> one that signed out*, which fails specifically for a per-configuration map —
> verified by mutation.

Each half of that is true and the conclusion is not. Both named tests run inside
**one** module registry:

- `expect(sharedRevokedStore()).toBe(sharedRevokedStore())` is two calls into one
  module instance.
- two `createAuthConfig()` calls, again in one registry, both reach the same
  module-level binding. That falsifies a **closure-scoped** map — the shape
  `0231-*` originally probed — and nothing else.

Neither can distinguish *one map per module registry* from *one map per realm*,
and that distinction is the entire thing `Symbol.for` + `globalThis` buys.
A module-level map is not a hypothetical alternative; it **is** the production
bug `0231-*` was written about, because Next.js gives the proxy, the
`/api/auth/*` handlers and the server components a module registry each.

The final review measured it. Replacing the whole body of `sharedRevokedStore()`
with a module-level `const MODULE_LEVEL_REVOKED = new Map()` (keeping the
`NEXT_RUNTIME` guard):

```
Test Suites: 7 passed, 7 total
Tests:       100 passed, 100 total
EXIT=0
```

The mechanism the fix exists for survived deletion with the suite green.

Re-measured here, with the same mutation applied to **both** stores and the two
new tests present:

```
● sharedRevokedStore › hands the same map to two independent module registries
● createTokenRefresher › sharedRefreshState › hands the same state to two independent module registries
Tests: 2 failed, 104 passed, 106 total
```

Two failures, and only those two — which also confirms the review's point that
nothing else in the suite could tell.

## How

`jest.isolateModules` runs its callback with a fresh module registry, so a second
`jest.requireActual('./revocation')` inside it evaluates the module again. That
is the closest thing available in one process to what Next.js does with its
bundles. The assertion is identity (`toBe`) followed by a write through one
handle and a read through the other, so the test states both the mechanism and
the property it buys.

`jest.requireActual` rather than bare `require`: it is a Jest API, so it does not
trip the lint rules that treat `require` in TypeScript as a mistake.

**The general rule this records:** a fix whose whole content is *which scope a
value lives in* cannot be tested from inside one instance of that scope. If a
future task moves either store behind Redis or a table, the equivalent test is
two connections, not two calls.

## Risk if this is wrong

`jest.isolateModules` resets the module registry but **not** the realm — the same
`globalThis`, and therefore the same global symbol registry, which is exactly why
the test works. It is a faithful model of Next.js's three server bundles (one
realm, three registries) and *not* a model of the Edge runtime (separate
isolates, separate `globalThis`). That case stays covered by
`sharedRevokedStore()` refusing to boot, and `revocation.spec.ts` › *refuses to
boot on the Edge runtime* remains the test for it.
