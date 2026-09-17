# 0308 – TanStack Query is used directly, `libs/query` is gone

**Date:** 2026-09-09 · **Status:** accepted · **Task:** `TODO.md` item 6 ·
**Supersedes:** the `libs/query` sections of `doc/decision/0037-*`, `doc/decision/0038-*`
and Task 19's entry in `doc/wrappers.md`

## What

`@tanstack/react-query` is no longer one of the mandatory wrapper layers listed
in `plan.md` and `doc/wrappers.md`. `libs/query` is deleted; app code imports
`useQuery`/`useMutation`/`useQueryClient`/`QueryClientProvider` straight from
`@tanstack/react-query`. `eslint.config.mjs`'s `WRAPPED_LIBRARIES` no longer
carries an entry for it, so nothing enforces a wrapper that no longer exists.

This is a deliberate, explicit override of `plan.md`'s wrapper mandate,
requested by the repository owner: there is exactly one consumer of TanStack
Query in this workspace (`apps/garage/web`), so a wrapper lib bought no swappability
it wasn't already getting for free, and cost an extra package, an extra Jest
environment, and an extra dual-package-hazard workaround (`doc/decision/0038-*`)
for no second consumer to justify it.

## Where the old wrapper's pieces live now

`libs/query` bundled three unrelated things. Each moved to where it is
actually used, rather than to one replacement package:

| old (`libs/query`)                                                                         | new                                                                                  | why there                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createApiQueryUtils` (the oRPC ↔ TanStack Query bridge, built on `@orpc/tanstack-query`) | `libs/shared/api-client/src/lib/api-query.ts`, exported from `@garage/api-client`        | `libs/shared/api-client` already owns the oRPC client and already allow-lists `@orpc/tanstack-query` as a `type:util` companion package (same precedent as `@hookform/resolvers`); the bridge is oRPC-shaped, not TanStack-Query-shaped |
| `createQueryClient` + the retry policy (`shouldRetryQuery`, `MAX_QUERY_RETRIES`)           | `apps/garage/web/src/shell/query/query-client.ts` (+ `retry.ts`)                            | single consumer, app-level policy — `apps/garage/web/src/shell/` already hosts other single-consumer app utilities (e.g. `api-provider/`)                                                                                               |
| `QueryProvider`                                                                            | deleted; call sites use `@tanstack/react-query`'s own `QueryClientProvider` directly | a provider that only forwarded a client to the real provider had nothing left to add once the import ban was lifted                                                                                                              |

Tests moved with their code: key-shape and delegation tests that don't need a
real `QueryClient` are in `libs/shared/api-client` (`api-query.spec.ts`); tests that
need both a real client and the bridge together — the branch-key invalidation
tests, and the end-to-end "component reads/mutates/invalidates through the
real stack" test — live in `apps/garage/web/src/shell/query/` (`query-client.spec.ts`,
`query-integration.spec.tsx`), because only `apps/garage/web`'s `tsconfig.json` uses
`module: esnext`; constructing a real `QueryClient` next to
`@orpc/tanstack-query` output under a `commonjs`-resolving tsconfig is exactly
the dual-package hazard `doc/decision/0038-*` documents, so the split keeps
every test on the resolution setting that actually works rather than carrying
`libs/query`'s custom Jest environment forward for no reason.

## What was lost, and accepted as a known consequence

`libs/query` exported `QueryClient` as a **type only**, so `new QueryClient()`
was a compile error and `createQueryClient` was the only way to get one — this
is what stopped app code from silently reintroducing TanStack's own defaults
(three retries on everything, including 4xx domain errors that are decisions,
not hiccups) while still passing the ESLint wrapper ban. That specific
enforcement is gone: `@tanstack/react-query`'s `QueryClient` is directly
importable everywhere now, so nothing stops a new call site from constructing
one by hand instead of calling `createQueryClient`. This was raised and
accepted, not overlooked: with one consumer, the cost of a wrapper class ban
outweighs a mistake that a code-review glance at "why is this file importing
`QueryClient` instead of `createQueryClient`" would catch.

## How it was verified

`npx nx run api-client:test`, `npx nx run web:test`, `npx nx run web:lint`,
`npx nx run api-client:lint` and `npx nx run web:typecheck` all pass. 743
tests total in `apps/garage/web` (up from 738 before this branch — 5 more from the
ported end-to-end usage test), plus `api-client`'s own suite. `libs/query` no
longer appears in `nx show projects`.

`plan.md` (git-ignored, does not travel with a worktree) was patched directly
by the repository owner rather than committed on this branch, the same
handling `doc/decision/0301-*` used for the same reason: the wrapper table's
`@tanstack/react-query` row removed, the tech-stack bullet and `libs/` file
tree updated to point here, and the Fáze 4 build-log entry for `libs/query`
struck through with a pointer to this record.
