---
name: tanstack-query
description: |
  This repo's own conventions for TanStack Query v5 in apps/garage/web, layered on
  top of general TanStack Query knowledge (the tanstack-skills plugin's
  `tanstack-query` skill, if installed, or https://tanstack.com/query/latest).

  Use when: adding a query or mutation in apps/garage/web, wiring a new provider,
  deciding on retry/stale-time behavior, or writing a test against the query
  layer.

  Covers: this repo's post-doc/decision/0308 layout (no libs/query wrapper),
  contract-derived query keys via createApiQueryUtils, the retry-by-HTTP-status
  policy, QueryClient defaults, provider setup, and the stubApi testing
  pattern.
metadata:
  version: 1.0.0
  last_updated: 2026-09-09
  package_versions:
    "@tanstack/react-query": "5.x"
    "@orpc/tanstack-query": "workspace-pinned, see package.json"
---

# TanStack Query in this repo

**Status:** `@tanstack/react-query` is used directly — it is **not** one of
this workspace's mandatory wrapper libraries. That was true through
`TODO.md` item 6; before it, `libs/query` was the only allowed import site.
`doc/decision/0308-*` records why it was removed and `doc/wrappers.md` has
the current reference section. This skill is the quick, task-oriented version
of the same material.

For general TanStack Query knowledge — query keys, `useInfiniteQuery`,
optimistic updates, devtools, framework-agnostic core concepts — defer to the
`tanstack-query` skill from the `tanstack-skills` plugin if it's installed,
or https://tanstack.com/query/latest. **This file only covers what's specific
to this codebase.**

## Where things live

| what                                                                  | where                                                                         |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| the oRPC ↔ TanStack Query bridge (`createApiQueryUtils`)             | `libs/shared/api-client/src/lib/api-query.ts`, exported from `@garage/api-client` |
| the app's `QueryClient` policy (`createQueryClient`)                  | `apps/garage/web/src/shell/query/query-client.ts`                                    |
| the retry policy (`shouldRetryQuery`, `MAX_QUERY_RETRIES`)            | `apps/garage/web/src/shell/query/retry.ts`                                           |
| the app's provider wiring                                             | `apps/garage/web/src/app/providers.tsx`                                              |
| test fixtures (`stubApi`, `rpcPayload`, `contractErrorResponse`, ...) | `apps/garage/web/src/testing/stub-api.ts`                                            |

There is no `libs/query`. Import `useQuery`/`useMutation`/`useQueryClient`/
`QueryClientProvider` straight from `@tanstack/react-query` — do not look for
a wrapper, and do not recreate one.

## Query keys are never written by hand

`createApiQueryUtils(client)` mirrors the contract router (`libs/garage/contract`),
so every procedure gets `queryOptions`, `mutationOptions`, `call`, and every
branch gets `key()` for partial matching:

```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiQueryUtils } from "@garage/api-client";

const utils = createApiQueryUtils(apiClient); // once, at the app root

function DayOverview() {
  const { data, error } = useQuery(utils.overview.day.queryOptions({ input: { date } }));
  // ...
}

function ReserveButton() {
  const queryClient = useQueryClient();
  const create = useMutation({
    ...utils.reservation.create.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: utils.overview.key() }),
  });
}
```

Never spell a query key as a literal array (`['overview', 'day', date]`) —
if it can be reached through `utils`, use `utils`. That's what keeps an
invalidation from silently missing a cache entry because someone typed the
key slightly differently on the write side.

## The provider

```tsx
const queryClient = createQueryClient(); // one per request (SSR) / per session
<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
```

`createQueryClient` is called once per request on the server and once per
session in the browser — never inside a component body, which would recreate
the client (and throw the cache away) on every render. Nothing currently
stops a call site from calling `new QueryClient()` directly instead; there's
no compile-time ban the way `libs/query` used to have one. If you're adding a
new provider or a new place a `QueryClient` gets constructed, call
`createQueryClient` — see `doc/decision/0308-*` for why this is a known,
accepted gap rather than an oversight.

## Errors: switch on the contract code, not the HTTP status

```tsx
import { toContractError } from "@garage/api-client";

const error = toContractError(caught); // ContractError | null
if (error?.code === "SPOT_ALREADY_RESERVED") {
  /* ... */
}
```

`toContractError` recognizes a domain error by its `code` (parsed through the
contract's `errorCodeSchema`), never oRPC's `isDefinedError`. `null` covers a
transport failure, an unknown code, and a thrown non-error value alike — all
three get generic "something went wrong" copy.

## Retry policy: by HTTP status, not by query vs. mutation defaults

`createQueryClient`'s defaults (`apps/garage/web/src/shell/query/query-client.ts`):

- `staleTime`: 30 s, `gcTime`: 5 min, `refetchOnWindowFocus: false` (realtime
  invalidation arrives over Socket.io, so refocus-refetch is redundant
  traffic).
- Queries: `retry: shouldRetryQuery` — a 4xx is **never** retried (it's an
  answer: a rejected reservation, a closed window), everything else retries
  up to `MAX_QUERY_RETRIES` (2). The split is by HTTP status, because it has
  to cover failures with no contract code at all (a throttled 429, an
  unmatched route).
- Mutations: **not retried, ever.** Every mutation in this contract writes
  something a person did on purpose; a silent retry after an ambiguous
  failure risks a duplicate write, and this app's unique constraints (no
  double-booking) would turn the retry into a _different_ error than the
  original.

Overrides passed to `createQueryClient(overrides)` merge one level deep — a
caller changing `queries.staleTime` doesn't silently drop `retry` or
`mutations`.

## Testing: drive the real transport, stub only `fetch`

Every query/mutation test in this repo builds a real `RPCLink` and stubs the
bottom-most `fetch` — never a hand-written fake client, since that would skip
the transport layer the retry policy and error mapping actually run through.
`apps/garage/web/src/testing/stub-api.ts` has the fixtures:

```tsx
import { stubApi, rpcPayload, contractErrorResponse } from "../../testing/stub-api";
import { createApiQueryUtils } from "@garage/api-client";
import { createQueryClient } from "./query-client";

const api = stubApi(() => ({ status: 200, body: rpcPayload(DAY_OVERVIEW) }));
const utils = createApiQueryUtils(api.client);
const queryClient = createQueryClient({ defaultOptions: { queries: { retryDelay: () => 0 } } });
// render inside <QueryClientProvider client={queryClient}>, assert on api.requests
```

Set `retryDelay: () => 0` in tests that exercise the retry path, or a 5xx test
takes real wall-clock time waiting between attempts.

Where a test needs both a real `QueryClient` and `createApiQueryUtils`
together (e.g. proving a branch key invalidates its leaves), it must live in
`apps/garage/web`, not `libs/shared/api-client`: only `apps/garage/web`'s `tsconfig.json` uses
`module: esnext`. Building both under a `commonjs`-resolving tsconfig hits the
dual-package hazard between `@tanstack/react-query`'s CommonJS `require`
condition and `@orpc/tanstack-query`'s ESM-only `import` condition —
documented in `doc/decision/0038-*`. `libs/shared/api-client`'s own
`api-query.spec.ts` only covers key shape/stability, deliberately avoiding a
real `QueryClient` construction.

## See also

- `doc/decision/0308-*` — why `libs/query` was removed and where each piece
  moved to.
- `doc/wrappers.md` — the workspace-wide wrapper-lib reference (this section
  is the "TanStack Query — used directly, not wrapped" entry).
- `doc/decision/0038-*`, `doc/decision/0039-*`, `doc/decision/0040-*` — the
  dual-package hazard, the error-mapping rationale, and the `ContractClient`
  generic, respectively.
