# 0024 – The Prisma client is generated inside `libs/garage/database` and committed

**Date:** 2026-08-28 · **Status:** accepted · **Affects:** Tasks 9–13, 30, and CI

## What

Prisma 7 requires an explicit `output` for the `prisma-client` generator – it no
longer generates into `node_modules`. The choice made:

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"   // libs/garage/database/src/generated/prisma
  moduleFormat = "cjs"
  runtime      = "nodejs"
}
```

The generated client (14 files, ~500 kB of TypeScript) is **committed to the
repo** and excluded from Prettier (`.prettierignore`). It is imported
exclusively via `@garage/database`; no other project reaches into
`src/generated/**`.

## Why

**Output inside `libs`.** The client is a derived artifact of the schema that
lives in this lib. If it lived in `node_modules` (Prisma 6) or at the repo
root, it would sit outside the reach of the `type:data`/`scope:api` tags, and
Nx wouldn't know about the dependency. This way, normal module boundaries
apply, and `@garage/database` is the sole entry point.

**`moduleFormat = "cjs"`.** The default is ESM. The whole backend, however, is
CommonJS (`apps/garage/api/tsconfig.app.json` → `"module": "commonjs"`, and Jest via
ts-jest too), so an ESM client would end in `ERR_REQUIRE_ESM`. Moving the whole
workspace to ESM is not a decision that belongs to Task 9.

**Why commit it, instead of generating at build time.** Both options were
weighed:

| | commit | `prisma generate` as a `dependsOn` |
| --- | --- | --- |
| `npm ci && npm run build` on a clean machine | works | needs an extra step |
| without `.env` | works | **fails** – `prisma.config.ts` calls `env('DATABASE_URL')`, which throws before generation even if the variable is missing |
| reviewing a diff | also shows generated code (noise) | clean diff |
| risk of drifting from the schema | real, but guarded by a test | none |

The second row decided it: generation works without a database, but **not**
without `.env`, and lint / typecheck / test / build must be runnable on a
machine that has neither the database nor `.env`. There's already a precedent
in the repo — `libs/shared/design-system/tokens/assets/tokens.css` is also generated
and committed (`doc/decision/0010-*`).

The risk of drifting from the schema is covered by a test:
`schema-contract-parity.spec.ts` reads metadata from the **generated client**
and compares it against the contract, so a stale client fails tests before it
ever reaches production.

## How

- `npx prisma generate` (from the root) regenerates the client; **the output
  is committed together with any schema change**, or tests fail.
- The target `database:prisma-generate` in `libs/garage/database/project.json` exists
  for convenience and for a future CI check of "is the client up to date"; it
  is not in any target's `dependsOn`, precisely because that would require
  `.env`.
- `.prettierignore` includes `/libs/garage/database/src/generated`. ESLint and `tsc`
  don't need special handling – the generated files carry
  `/* eslint-disable */` and `// @ts-nocheck` right in their header.
- `@prisma/*` was already present in `NPM_ALLOWLIST` for the `type:data` tag;
  `@prisma/adapter-pg` therefore didn't need adding.

## Risk if this is wrong

Someone changes `schema.prisma` and forgets to commit the client →
`database:test` fails on a field mismatch. That's a loud failure, not a silent
one.

The worse case runs the other way: someone hand-edits the generated client.
The only defense is the "Do not edit directly" header in every file; if it
happens anyway, the next `prisma generate` overwrites it without warning.
