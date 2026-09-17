# 0046 – `libs/garage/auth` has two entry points, server and client

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 20 (`libs/garage/auth`)
**Follows on from:** `doc/decision/0023-*` (the contract's second entry point)

## What

One lib, one owner of `next-auth`, two import paths:

| path | resolves to | contains |
| --- | --- | --- |
| `@garage/auth` | `libs/garage/auth/src/index.ts` | `createAuth`, `createAuthConfig` and its callbacks, `createTokenRefresher`, `createAccessTokenProvider` |
| `@garage/auth/client` | `libs/garage/auth/src/client/index.ts` | `AuthProvider`, `useRequireAuth`, `useAccessTokenProvider`, plus `useSession`/`signIn`/`signOut` |

> **2026-09-04:** the server row's inventory has narrowed. `@garage/auth` now exports
> `createAuth` and `OKTA_PROVIDER_ID` plus the types `Auth` and `AuthOptions`;
> `createAuthConfig`, `createTokenRefresher` and `createAccessTokenProvider` became
> module-scoped implementation of `createAuth`. **The decision this record makes — two entry
> points, server and client — is unchanged**, and so is everything below. The live inventory
> is `libs/garage/auth/src/index.ts` and `doc/wrappers.md`.

Both aliases are in `tsconfig.base.json`. There is one `project.json`, one tag pair
(`type:util`, `scope:web`), one Jest project, and one `WRAPPED_LIBRARIES` entry.

## Why

**The two halves import different things.** `@garage/auth` reaches `next-auth`'s default
export, which pulls in route handlers, `next/server` and Auth.js's OAuth machinery.
`@garage/auth/client` reaches only `next-auth/react`. A single barrel re-exporting both
would put the server half in the module graph of every client component that wanted
`useSession` — Next.js would either bundle it or fail on a server-only import, and which of
the two you get depends on tree-shaking, which is not a guarantee to build a boundary on.

**A second lib would be worse.** Splitting into `libs/garage/auth` and `libs/garage/auth-client` means two
projects, two tag sets, two Jest configs — and, critically, **two** `WRAPPED_LIBRARIES`
owners for one package, or an owner that does not cover half the code. The map's shape
(`pkg → one owner directory`) is what makes the ban and the exemption generate from a single
source; giving `next-auth` two owners is exactly the kind of hand-maintained duplication that
map exists to remove.

**Precedent.** `libs/garage/contract` already does this for `@garage/contract` and
`@garage/contract/realtime`, for the same reason: one owner of a concept, two audiences.

**No `'use client'` directive here.** `client.tsx` carries none, matching `QueryProvider` in
`libs/query` and `IntlProvider` in `libs/shared/i18n`: the app marks its own provider boundary as a
client component and composes all three there. A directive inside a wrapper would decide the
boundary's location on the app's behalf.

**Shared vocabulary goes in the module neither half owns.** `REFRESH_TOKEN_ERROR` and
`OKTA_PROVIDER_ID` live in `src/lib/session.ts`, which imports nothing but types. The first
draft had `OKTA_PROVIDER_ID` in `config.ts`, which dragged `next-auth/providers/okta` and the
token refresher into the browser bundle through one constant — the failure this split exists
to prevent, reintroduced by an import.

## How

`src/client/index.ts` re-exports from `src/lib/client.tsx`. The client module's own imports
are `react`, `next-auth/react`, `./access-token` (a pure function), and `./session` (types and
two constants) — nothing that reaches `next-auth`'s server entry.

Verified with a real build rather than by reading imports. A temporary `apps/garage/web` route —
`page.tsx` as a Server Component calling `createAuth()` and `await auth()`, beside a
`'use client'` `client-part.tsx` using `AuthProvider` and `useRequireAuth` — compiled under
`nx build web --skip-nx-cache`:

```
▲ Next.js 16.1.7 (Turbopack)
✓ Compiled successfully in 719.9ms
Route (app)
└ ƒ /probe
```

Probe files deleted afterwards.

That build is a point-in-time check, so the split also has a standing guard:
`client-boundary.spec.ts` registers a throwing `jest.mock` for `next-auth`,
`next-auth/providers/okta`, `./config` and `./create-auth`, then imports `../client`. A
factory only runs if the client entry really requires that module, so the suite fails at
import time the moment the boundary is crossed.

That guard was itself probed, and the first version of it was wrong. Watching only
`next-auth` left the suite **green** with a deliberate `./config` import in `client.tsx`,
because `config.ts` reaches `next-auth/providers/okta` and takes the rest as types — it never
requires the bare server entry. The list had to name our own server modules too. With the
corrected list the probe failed as intended:

```
@garage/auth/client reached "./config" — the server half.
  at Object.require (src/lib/client.tsx:21:1)
  at Object.require (src/client/index.ts:13:1)
```

## Risk if this is wrong

The guard watches the **runtime** module graph, not the source text: babel drops an imported
binding that is never used, so an unused `import { X } from './config'` does not trip it.
That matches what a bundler would do — an unused import is not in the bundle either — but it
does mean the guard is not a lint rule and cannot be read as one.

It also enumerates the server modules by hand. A new server-only module added to
`libs/garage/auth/src/lib/` is not covered until someone adds it to that list. The list is four
entries long and sits next to the modules it names, which is the best available trade against
a lint rule in `eslint.config.mjs` — this project's enforcement surface, where three separate
rules have already been found silently inert, and where a rule with one subject reads as
noise.
