# 0038 – `libs/query/tsconfig.spec.json` must not set `module: commonjs`

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 19 (`libs/query`)

## What

Every other lib's `tsconfig.spec.json` in this workspace sets `"module": "commonjs"` — it is
what the Nx generator emits. `libs/query`'s **omits it**, inheriting `"module": "esnext"`
from `tsconfig.base.json`. `moduleResolution: "bundler"` stays.

This is a typecheck-only change. Nothing is emitted from that program (`tsc --noEmit`), and
the test files themselves are transpiled by babel-jest, which does not read this setting. It
affects **module resolution and nothing else**.

## Why

`@tanstack/react-query` and `@tanstack/query-core` are dual packages: their `exports` maps
offer `import` (`index.d.ts`) and `require` (`index.d.cts`) conditions with **separate
declaration files**. `@orpc/tanstack-query` is ESM-only.

With `module: commonjs`, TypeScript resolved:

- `@tanstack/react-query`, imported by `libs/query`'s own source → the **`require`** condition,
  `build/modern/index.d.cts`;
- `@tanstack/query-core`, reached through ESM-only `@orpc/tanstack-query` → the **`import`**
  condition, `build/modern/index.d.ts`.

Both declare a `QueryClient`. They are structurally identical and nominally distinct, and
`QueryClient` has a `#private` brand, so structural compatibility does not save it. Every
call handing a `queryOptions()` result to a `QueryClient` failed:

```
error TS2379: Argument of type '{ input: … } & Omit<QueryOptionsBase<…>>' is not assignable
to parameter of type 'FetchQueryOptions<…>' with 'exactOptionalPropertyTypes: true'.
  Types of property 'queryFn' are incompatible.
    …
        Types of property 'client' are incompatible.
          Type 'import(".../hydration-DWGr3cFC").on' is not assignable to
          type 'import(".../hydration-Bjs0MSgg").on'.
            Property '#private' in type 'QueryClient' refers to a different member
            that cannot be accessed from within type 'QueryClient'.
```

Two different hashed declaration files for the same package, from the same `node_modules` —
confirmed with `tsc --traceResolution`, which showed react-query resolving to `index.d.cts`
and query-core to `index.d.ts` in the same program. `libs/query/tsconfig.lib.json` never had
the problem, because it does not set `module` and so was always on `esnext`.

**Why this and not a cast.** The error reads like a generics mismatch and invites
`as unknown as QueryClient` at the call site, or a locally re-declared options type. Both
would compile and both would be lies: there is nothing wrong with the parameterisation — the
program was simply looking at two copies of one package. A cast would also have to be
repeated at every call site and would survive the day the real cause is fixed.

**Why not force the whole workspace onto `esnext`.** Every other spec program typechecks
cleanly as-is, and the shared `jest.preset.js` / ts-jest setup elsewhere is CommonJS. Changing
the workspace default to fix one lib is a broad change with no other beneficiary, made while a
parallel task is in flight. One deviation, commented in the file it lives in, is the smaller
claim.

**Why not `moduleResolution: node16`.** It would also make the conditions consistent, but by
switching this program to Node's ESM rules — which would then demand explicit file extensions
on relative imports across the whole lib. `bundler` is what the rest of the workspace uses and
what Next.js actually applies to this code.

## How

`libs/query/tsconfig.spec.json` simply omits `"module"`, with a comment stating the above.
The guard against regression is `npx nx run query:typecheck`, which fails with the error
quoted here if someone restores `commonjs` to match the other libs.

## Risk if this is wrong

The spec program now resolves modules differently from how `ts-jest` would if this lib ever
adopted it, so a construct that typechecks here could fail there. Low: babel-jest strips
types without checking them, so the two are not currently required to agree — but a future
migration of `libs/query` to ts-jest has to revisit this file rather than assume it matches
`libs/garage/contract`'s.

The wider risk is that the same dual-package split reappears in the **next** lib that pairs an
ESM-only package with a dual one — `libs/garage/realtime-client` (Task 21, `socket.io-client`) is the
likely next case. The symptom is unmistakable once seen (`#private … refers to a different
member`), and the fix is this file; the trap is reading it as a generics problem and casting.
