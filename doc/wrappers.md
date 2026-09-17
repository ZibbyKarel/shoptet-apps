# Wrapper layers

Founded by Task 18 (`libs/shared/form`), the first of a run of Tasks 18–22 that progressively
establishes the rest of `WRAPPED_LIBRARIES`. Task 19 added `libs/shared/api-client` and
`libs/query`, Task 20 `libs/garage/auth`, Task 21 `libs/garage/realtime-client`, Task 14
`libs/garage/calendar-export` — the one backend wrapper. Each wrapper adds its own section here, not
a new file. `libs/query` was later removed (`TODO.md` item 6, `doc/decision/0308-*`):
`@tanstack/react-query` is no longer wrapped, since this workspace only ever had one
consumer for it.

## What a wrapper lib is and why it's mandatory

`plan.md` and `doc/workspace.md` (the "Wrapper layers" section) forbid application and
library code from importing certain third parties directly. For each of them there is
exactly one **wrapper lib** — the single place in the whole workspace allowed to import it:

| forbidden package       | wrapper lib                            | tag                      |
| ----------------------- | -------------------------------------- | ------------------------ |
| `react-hook-form`       | `libs/shared/form` (done, Task 18)            | `type:util`, `scope:web` |
| `@tanstack/react-table` | `libs/shared/design-system/src/compounds`     | `type:ui`, `scope:web`   |
| `@orpc/client`          | `libs/shared/api-client` (done, Task 19)      | `type:util`, `scope:web` |
| `socket.io-client`      | `libs/garage/realtime-client`                 | `type:util`, `scope:web` |
| `next-auth`             | `libs/garage/auth`                            | `type:util`, `scope:web` |
| `ical-generator`        | `libs/garage/calendar-export` (done, Task 14) | `type:util`, `scope:api` |
| `next-intl`             | `libs/shared/i18n` (done, Task 17)            | `type:util`, `scope:web` |

The reason for the ban isn't "save a few characters of import" but three concrete things a
direct import anywhere else would break:

1. **The third party's version and behavior stay swappable in exactly one place.** If
   `apps/garage/web` called `react-hook-form` directly in ten places, a major-version upgrade or a
   swap for a different library (`libs/shared/form` internally uses `@hookform/resolvers`) would
   mean ten places to fix instead of one.
2. **The contract remains the single source of truth for the shape of the data.** The
   wrapper is the bridge between the Zod schema (`libs/garage/contract`) and the rest of the stack —
   `libs/shared/form` takes a Zod schema and validates against it, `libs/shared/api-client` will take the
   oRPC contract. A direct import of the library would bypass that bridge and open the door
   to hand-written validation that drifts from the contract over time.
3. **The boundary can be enforced mechanically, not just by review.** `eslint.config.mjs`
   (`no-restricted-imports` + `@nx/enforce-module-boundaries`) checks it on every
   `npm run lint` run (`--max-warnings=0`) — a reviewer doesn't have to remember the rule,
   the build fails instead.

## How the ban is enforced

One map, `WRAPPED_LIBRARIES` in `eslint.config.mjs`, is the single source of truth for the
pair (forbidden package → owning directory). It generates:

- the **global ban** (`no-restricted-imports` on `apps/**` and `libs/**`) — one pattern per
  package from the map, with an error message that names the wrapper to use instead;
- the **owner's exception** (`wrapperLibOverrides`) — the same rule, but with the owner's
  package subtracted from the forbidden list, applied only to `<owner>/**`.

This one map is also why `doc/workspace.md` warns about "silently does nothing": both rules
(the ban and the exception) draw from the same data, so they can't drift apart, but
**`basePath: workspaceRoot`** is still required on both — Nx runs `eslint .` with cwd set to
the project's directory, so a workspace-relative glob (`libs/shared/form/**`) without `basePath`
compares against the wrong path and never matches.

**The owner is one directory, never a namespace.** Since the workspace was namespaced to
host two applications (`doc/decision/0310-*`), the wrapper libs are split across
`libs/shared/` and `libs/garage/`. Collapsing those owner globs to `libs/shared/**` to
"simplify" the map would hand **every** shared lib **every** package's exception — and
`npm run lint` would still pass, because the ban and the exception would still be generated
from the same data, just from data that is now wrong. That is the "silently does nothing"
failure in its purest form. Each owner stays the specific directory that owns its package,
and the way to check it is a probe, not a green lint: put an import of a package a lib does
**not** own into that lib and confirm the error names the right wrapper.

Besides banning the package import, wrapper libs also carry the Nx `type:util` dimension,
whose `allowedExternalImports` is the union of every package in `WRAPPED_LIBRARIES` plus
their React/Next peer dependencies (`doc/workspace.md`) — **exactly who is allowed to import
whom** (that `libs/shared/form` may import only `react-hook-form`, not `next-auth`) is guarded only
by the `no-restricted-imports` override, because the Nx dimension alone can't make that
distinction (every wrapper lib carries the same tag at once).

### `libs/shared/form` and the design system — why this isn't another exception in the same map

`libs/shared/form` is unusual in one respect: `FormField` has to "connect" a Zod error and a
design-system primitive (`Input`/`Select`/`Checkbox`), but it **does not import the design
system** in its production code — it does this as a generic render prop
(`doc/decision/0030-*`). Composing it with a concrete primitive is left to the caller
(the future `apps/garage/web`), the same way as any other design-system composition. The only
place where `libs/shared/form` needs the design system at all is its own demonstration test
(`app-form.spec.tsx`) — and that has its own narrowly targeted ESLint override
(`doc/decision/0030-*`), not an extension of `WRAPPED_LIBRARIES`.

### Usage example

`FormField` is a generic render prop (see above) — it connects one field's value, `onChange`,
`onBlur`, `ref`, and the resolved Zod error to whatever primitive the caller picks. For
`Input` and `Select`, spreading `{...field}` directly is enough, because their
`value`/`onChange` match what react-hook-form sends. **`Checkbox` does not** — it's a native
`<input type="checkbox">`, which carries its state through `checked` (a boolean), not
`value`, and whose `onChange` sends an event whose `target.checked` (not `target.value`)
needs to be sent back into `field.onChange`. This is exactly where the render-prop design
hands responsibility to the caller — and exactly what's easiest to forget when writing a new
domain form:

```tsx
import * as z from "zod";
import { Checkbox, Input, Select } from "@garage/design-system/primitives";
import { FormField, FormProvider, useAppForm } from "@garage/form";

const bookingSchema = z.object({
  spotId: z.string().min(1, "Choose a spot"),
  vehicleType: z.enum(["car", "motorcycle"]),
  recurring: z.boolean(),
});

function BookingForm() {
  const form = useAppForm({
    schema: bookingSchema,
    defaultValues: { spotId: "", vehicleType: "car", recurring: false },
  });

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit((values) => submitBooking(values))}>
        {/* Input/Select: field shape already matches value/onChange, spread directly. */}
        <FormField
          name="spotId"
          render={({ field, error }) => <Input label="Parking spot" error={error} {...field} />}
        />
        <FormField
          name="vehicleType"
          render={({ field, error }) => (
            <Select label="Vehicle" error={error} {...field}>
              <option value="car">Car</option>
              <option value="motorcycle">Motorcycle</option>
            </Select>
          )}
        />

        {/* Checkbox adapter: checked (not value), and onChange must read
            event.target.checked back into field.onChange — a plain
            {...field} spread here would silently do nothing on click. */}
        <FormField
          name="recurring"
          render={({ field, error }) => (
            <Checkbox
              label="Repeat this reservation weekly"
              error={error}
              name={field.name}
              checked={field.value}
              onChange={(event) => field.onChange(event.target.checked)}
              onBlur={field.onBlur}
              ref={field.ref}
            />
          )}
        />

        <button type="submit">Reserve</button>
      </form>
    </FormProvider>
  );
}
```

The same pattern (with tests over `Checkbox` too) is verified in
`libs/shared/form/src/lib/app-form.spec.tsx` — this example is drawn directly from it, just with the
parking domain instead of the generic demo schema.

## How to add another wrapper lib (Tasks 20–22)

1. **Generate the lib** the same way as any other (`doc/workspace.md`, "How to add a new
   lib"). Tags: `type:util`, `scope:web` (or `scope:api` for `libs/garage/calendar-export`).
2. **Add an entry to `WRAPPED_LIBRARIES`** in `eslint.config.mjs` — `owner` (the lib's
   directory) and `use` (the import path). The global ban and the exception for the new
   wrapper are generated automatically, nothing else needs to be written.
3. **If the package needs its own helper dependency** (like `@hookform/resolvers` for
   `react-hook-form`), add it separately to `NPM_ALLOWLIST.util` — it isn't part of
   `WRAPPED_LIBRARIES`, because it doesn't stand in for anyone by itself, and only makes
   sense paired with the wrapped package.
4. **Write three kinds of tests** (as Task 17 did for `next-intl` and Task 18 for
   `react-hook-form`):
   - that the wrapper can actually be used (render/call through its public API),
   - that it behaves according to the contract/data it wraps (validation, formatting, ...),
   - that application code **doesn't need to** import the wrapped library directly to use
     the wrapper — not just that the export exists, but a real, running example.
5. **Verify both the ban and the exception with temporary probe files**, not just that
   `npm run lint` passes green (`doc/workspace.md` — this trap has already happened three
   times): one import of the wrapped package inside the new lib (expected: passes), the same
   import from somewhere else (expected: fails with a message that names the correct
   wrapper). Delete the probe files once verified.
6. `npm run lint && npm run typecheck && npm run test` + `npm run build`, add a section
   here.

## `libs/shared/form` tests

| file                    | what it verifies                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-app-form.spec.tsx` | `useAppForm` + `FormField` on a bare `<input>`: a Zod error propagates into `role="alert"` and `aria-invalid`; a valid submit calls the handler with the values after Zod parsing                                                                                 |
| `app-form.spec.tsx`     | the same, on real `Input`/`Select`/`Checkbox` from `@garage/design-system/primitives` — three fields, three different primitives, one Zod schema; plus a test that reads its own source file and verifies there is no direct import of `react-hook-form` in it |

Zod in the tests is always a local `z.object(...)` schema, not an import from
`@garage/contract` — `libs/shared/form` is domain-independent, and `@orpc/contract` (ESM-only,
see `doc/decision/0020-*`) would add a transform to its Jest config that this task doesn't
need. So there is no fourth copy of the ESM-transform block (`doc/decision/0020-*`, `0025-next-intl-esm-jest-transform`)
in `libs/shared/form/jest.config.cts`, nor was one needed.

---

## `libs/shared/api-client` — the oRPC client (Task 19)

`@garage/api-client` is the only place in the workspace allowed to import `@orpc/client`.
It exports exactly two things, plus their types:

```ts
import { createApiClient, toContractError } from "@garage/api-client";

const api = createApiClient({
  url: "https://example.test/rpc",
  getAccessToken: () => session?.accessToken, // libs/garage/auth, Task 20
});

const overview = await api.overview.day({ date: "2026-09-15" });
```

`ApiClient` is `ContractClient` — **derived from `libs/garage/contract`**, not written out. Every
procedure, input, output and declared error code is regenerated from the Zod schemas on each
build, so it cannot drift from the backend the way a hand-written client would, and no
endpoint that the contract does not declare can be called at all.

The `ContractRouterClient<Contract>` application lives in `libs/garage/contract` rather than here, so
that `@orpc/contract` stays allow-listed for `type:contract` alone. `NPM_ALLOWLIST` hangs off
the `type:` tag, which is shared by every wrapper lib, so granting it to `libs/shared/api-client`
would have granted it to `libs/shared/form` and `libs/shared/i18n` too — see `doc/decision/0040-*`.

### The access token is a provider, not a string

`getAccessToken` is a function (sync or async) and is called **per request**, so a token
refreshed after the client was constructed is picked up. Returning `null`, `undefined` or
`''` omits the `Authorization` header entirely rather than sending `Bearer undefined` —
covered by four cases in `api-client.spec.ts`. `libs/garage/auth` (Task 20) supplies the real
implementation; until then any caller can inject one.

### Reading errors

```ts
const error = toContractError(caught);        // ContractError | null
if (error?.code === 'SPOT_ALREADY_RESERVED') { … }
```

`toContractError` recognises a domain error by its **code**, parsed through the contract's
`errorCodeSchema` — deliberately **not** by oRPC's `isDefinedError`, which narrows on the
`defined` flag that `apps/garage/api` sets to `false` on every domain error it serialises. Using it
would reject every real domain error this backend produces. Full reasoning:
`doc/decision/0039-*`.

> **Known, reproduced and unguarded:** `apps/garage/api`'s filter writes its error body at the top
> level, but the RPC protocol reads it out of a `{ json, meta }` envelope — so a 409
> `SPOT_ALREADY_RESERVED` currently arrives as `CONFLICT`, which is also a member of
> `ERROR_CODES` and therefore does _not_ fail closed. **No test watches for this**; the guard
> that would work belongs in `apps/garage/api`'s filter spec and does not exist yet.
> `doc/decision/0039-*` states the situation and why `libs/shared/api-client` cannot guard it.

`null` means "not a domain error" and covers a transport failure, an unknown code, and a plain
thrown value alike — none of them has localized copy keyed to a code, so all three are
"something went wrong". `errorStatus(error)` gives the HTTP status, or `undefined` when the
request never reached a server; that distinction is the entire input to the app's retry
policy (below).

## TanStack Query — used directly, not wrapped (`doc/decision/0308-*`)

`@tanstack/react-query` was wrapped by `libs/query` (Task 19) until `TODO.md` item 6 removed
it: this workspace only ever had one consumer, and the wrapper bought no swappability that
consumer wasn't already getting for free. Feature code now imports
`useQuery`/`useMutation`/`useQueryClient`/`QueryClientProvider` straight from
`@tanstack/react-query`; the oRPC-to-TanStack-Query bridge lives in `libs/shared/api-client`, and the
app's `QueryClient` policy lives in `apps/garage/web/src/shell/query/`:

```tsx
import { useQuery, useMutation, useQueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createApiQueryUtils, toContractError } from "@garage/api-client";
import { createQueryClient } from "./shell/query/query-client";

const utils = createApiQueryUtils(api); // once, at the app root
const queryClient = createQueryClient(); // one per request (SSR) / per session

function DayOverview() {
  const { data, error } = useQuery(utils.overview.day.queryOptions({ input: { date } }));
  if (error) return <Alert code={toContractError(error)?.code} />;
  return <SpotGrid spots={data.spots} />;
}
```

**Query keys are still never written by hand.** `createApiQueryUtils` (`libs/shared/api-client`,
built on `@orpc/tanstack-query`) mirrors the contract router, so each leaf carries `queryKey`,
`queryOptions`, `mutationOptions` and `call`, and each branch carries `key()` for partial
matching. Invalidating "everything about the day overview" is
`invalidateQueries({ queryKey: utils.overview.key() })` — which is exactly what keeps a cache
entry from being missed because someone spelled its key differently.

### The client and the provider

```tsx
const queryClient = createQueryClient(); // one per request (SSR) / per session
<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
```

A client created in a component body is re-created on every render, throwing the cache away,
and Next.js needs one instance per request on the server and one per session in the browser —
`createQueryClient` is called once, at the app's provider, deciding that.

Unlike the removed wrapper, nothing stops app code from calling `new QueryClient()` directly
instead of `createQueryClient` — `doc/decision/0308-*` records that loss and why it was
accepted. `createQueryClient` still carries the project's policy — `staleTime` 30 s, `gcTime` 5 min,
`refetchOnWindowFocus: false` (realtime invalidation arrives over Socket.io in Task 21, so
refetching on focus is redundant traffic), `retry: shouldRetryQuery`, and **mutations are not
retried**. Overrides merge one level deep, so a caller changing one option cannot silently
drop the rest.

### The retry policy

A **4xx is never retried**; everything else is retried up to `MAX_QUERY_RETRIES` (2). The
split is by HTTP status rather than by contract code, because it has to cover failures that
carry no code at all — a throttled request and an unmatched route keep Nest's shape
(`doc/decision/0033-*`). A rejected reservation or a closed window is a _decision_: repeating
it produces the same answer three times, delays the error the user needs to see, and spends
three requests against the throttler. A 5xx and a dropped connection are the transient cases
retries exist for.

Mutations are not retried because every mutation in this contract writes something a person
did on purpose; a silent second attempt after an ambiguous failure risks a duplicate write,
and the unique constraints that prevent double-booking would turn the retry into a _different_
error than the original.

### Tests

| file                                                  | what it verifies                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-client/src/lib/api-client.spec.ts`               | the URL, method and payload a contract procedure puts on the wire; nested admin paths; the `Authorization` header across five provider cases including per-request re-reads                                                                                                                                                                           |
| `api-client/src/lib/errors.spec.ts`                   | a domain error maps onto its contract code/status/details; a sweep over all twelve `ERROR_CODES`; `null` for an unknown code, a throttled 429 and a network failure; the `defined: false` case that `isDefinedError` would reject; and one test documenting oRPC's own envelope behaviour (which is _not_ a guard on `apps/garage/api` — see the note above) |
| `api-client/src/lib/api-query.spec.ts`                | key stability (same input, across two util trees) and key distinctness, without constructing a real `QueryClient` (see the note below on why)                                                                                                                                                                                                         |
| `apps/garage/web/src/shell/query/query-client.spec.ts`       | the shipped defaults, override merging, and the retry policy counted in **requests that reached the transport** — one attempt for each of the twelve codes and for a 429, three for a 5xx and for an unreachable server; plus the two invalidation tests proving a branch key really invalidates its leaves through the cache's own matcher           |
| `apps/garage/web/src/shell/query/query-integration.spec.tsx` | a real component reading, mutating and invalidating through `@tanstack/react-query` and `@garage/api-client` together, end to end                                                                                                                                                                                                                  |

Every one of these drives a **real** `RPCLink` with only the bottom-most `fetch` stubbed. A
hand-written fake client would skip the transport, which is precisely where the errors under
test are produced. `apps/garage/web/jest.config.cts` already ships the custom Jest environment this
needs (jsdom + Node's fetch/stream globals; `doc/decision/0037-*`), which is also why the
tests that construct a real `QueryClient` next to the `@orpc/tanstack-query` bridge live in
`apps/garage/web` rather than `libs/shared/api-client`: only `apps/garage/web`'s `tsconfig.json` uses `module:
esnext`, and building both together under a `commonjs`-resolving tsconfig is the dual-package
hazard `doc/decision/0038-*` documents. `doc/decision/0308-*` has the full split.

### One allow-list addition, and one deliberately refused

`NPM_ALLOWLIST.util` in `eslint.config.mjs` carries one entry for `@orpc/tanstack-query`,
the bridge `libs/shared/api-client` is built on. It does not belong in `WRAPPED_LIBRARIES` for the same
reason `@hookform/resolvers` doesn't — nothing could be imported _instead_ of it, it only
makes sense paired with a package that is already wrapped. Unlike `@hookform/resolvers`, it no
longer pairs with a wrapped package at all: `@tanstack/react-query` itself stopped being
wrapped in the same change (`doc/decision/0308-*`), and the allow-list entry stayed because
`libs/shared/api-client`'s bridge (`api-query.ts`) still needs it.

`@orpc/contract` was **not** added, although `libs/shared/api-client` needs `ContractRouterClient`.
`NPM_ALLOWLIST` hangs off the `type:` tag, which every wrapper lib shares, so the entry would
have handed the contract builder to `libs/shared/form`, `libs/shared/i18n` and every wrapper still to come —
undoing the narrowness `NPM_ALLOWLIST.contract` is documented to have (`doc/decision/0007-*`).
`libs/garage/contract` applies the generic and exports `ContractClient` instead: `doc/decision/0040-*`.

## `libs/garage/auth` — next-auth v5 / Auth.js (Task 20)

`@garage/auth` is the only place in the workspace allowed to import `next-auth` —
including `next-auth/react`, `next-auth/jwt` and `next-auth/providers/okta`, all of which the
`next-auth/*` half of the ban pattern covers. It is a **type:util, scope:web** lib with
**two** entry points:

> The dependency is pinned **exactly** to `next-auth@5.0.0-beta.32`, and that is not an
> oversight to tidy up: Auth.js has never moved the `latest` tag off v4, so `latest` installs
> v4, `^5.0.0` matches nothing, and `@next` installs a v4 prerelease. Read
> `doc/decision/0050-*` before changing that line.

| import path              | runs where             | contains                                                                                                    |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@garage/auth`        | Next.js server runtime | `createAuth`, `OKTA_PROVIDER_ID`, and the types `Auth` and `AuthOptions`                                    |
| `@garage/auth/client` | browser                | `AuthProvider`, `useRequireAuth`, `useAccessTokenProvider`, and `useSession`/`signIn`/`signOut` re-exported |

There is exactly one way in on the server side, and it is `createAuth`: one call in `apps/garage/web`
produces the route handlers, the universal `auth()`, server-side `signIn`/`signOut` and a
`getAccessToken` ready to hand to `createApiClient`. `OKTA_PROVIDER_ID` sits beside it because
the sign-in page has to name the provider it dials. Everything the lib is assembled from —
`createAuthConfig` and its three callbacks, the token refresher, the access-token seam, the
sign-out revocation registry — stays module-scoped: it is `createAuth`'s implementation, not a
second supported way to build an Auth.js instance, and publishing it made it impossible to
tell from the interface which of twenty-eight symbols was the entry point. The lib's own specs
reach them through `./lib/config`, `./lib/refresh`, `./lib/revocation` and
`./lib/access-token`.

The split is the same idea as `@garage/contract` / `@garage/contract/realtime`: Auth.js's
server half pulls in route handlers and `next/server`, which have no business in a browser
bundle. Verified with a temporary `apps/garage/web` page — a Server Component importing
`@garage/auth` beside a `'use client'` component importing `@garage/auth/client` — built
by `nx build web` before being deleted.

### Wiring it up (Task 23 does this for real)

```ts
// apps/garage/web/src/auth.ts
import { createAuth } from "@garage/auth";
import { validateWebEnv } from "./env";

const env = validateWebEnv();

export const { handlers, auth, signIn, signOut, getAccessToken } = createAuth({
  issuer: env.AUTH_OKTA_ISSUER,
  clientId: env.AUTH_OKTA_CLIENT_ID,
  clientSecret: env.AUTH_OKTA_CLIENT_SECRET,
  secret: env.AUTH_SECRET,
  signInPath: "/login", // optional
});

// apps/garage/web/src/app/api/auth/[...nextauth]/route.ts
export const { GET, POST } = handlers;

// apps/garage/web/middleware.ts
export { auth as middleware } from "./src/auth";
```

`createAuth` reads **no** environment variable of its own — Auth.js's `AUTH_SECRET` /
`AUTH_OKTA_ID` / `AUTH_OKTA_SECRET` inference is deliberately bypassed so that
`apps/garage/web/src/env.ts` stays the single schema deciding which variables exist. A test
constructs the instance with all of them deleted from `process.env`.

### The token seam

`createAuth().getAccessToken` **is** the `AccessTokenProvider` that `libs/shared/api-client` was
built around in Task 19 — that indirection is what keeps the two libs from importing each
other's third-party package:

```ts
const api = createApiClient({ url, getAccessToken }); // server
```

In the browser the same shape comes from a hook, so a long-lived client or Socket.io
connection is not rebuilt on every session refresh:

```tsx
const getAccessToken = useAccessTokenProvider(); // stable identity, reads the latest session
```

Both return `null` — never a stale token — when the session is absent or reports
`RefreshTokenError`, so `createApiClient` omits the `Authorization` header entirely and the
API answers "unauthenticated" rather than producing a 401 that looks like a bug.

### What is stored where

| value                        | where it lives                                         | reaches the browser?                       |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| refresh token                | encrypted, httpOnly Auth.js session cookie             | **no** — `projectSession` does not copy it |
| access token                 | the same cookie; React state after `/api/auth/session` | yes, in memory only                        |
| `AUTH_SECRET`, client secret | `process.env`, server only                             | **no** — nothing is `NEXT_PUBLIC_`         |

Nothing is written to `localStorage`, `sessionStorage`, or a JS-readable cookie. `next-auth`
contains no reference to either storage API (`grep -rl localStorage node_modules/next-auth/`
returns nothing), and a jsdom test renders the real `SessionProvider` with a token in the
session while spying on `Storage.prototype.setItem`: it is never called, both stores stay
empty, and `document.cookie` never contains the token.

### Refresh token rotation

Rotation lives in the `jwt` callback (`rotateAccessToken`), which Auth.js runs whenever the
session is read:

1. At sign-in the `account` carries `access_token`, `expires_at` and `refresh_token`; they are
   copied onto the JWT. Without them the session is marked failed rather than left tokenless.
2. On later reads, a token more than `REFRESH_SKEW_SECONDS` (60 s) from expiry is returned
   untouched — no network call.
3. Inside the skew, the refresh token is exchanged at the provider's **discovered** token
   endpoint. A minute of headroom exists because a token renewed exactly at `exp` races its
   own request.
4. On failure the access token and refresh token are **dropped** and `error:
'RefreshTokenError'` is set. A session already in that state is not retried.

`AuthProvider` polls `/api/auth/session` every `SESSION_REFETCH_SECONDS` (300) — that is what
makes step 3 happen in an idle tab, since the callback only runs when something asks for the
session. Auth.js's default is no polling at all, which would let a tab hold a token until it
expired.

Concurrent callers presenting the same refresh token share **one** grant: one page load can
read the session several times (layout, Server Component, Route Handler, plus the browser
poll), and with rotation enabled on the authorization server the first grant would invalidate
the token under the others, signing the user out mid-session. The coalescing is per process,
which covers the single-instance target; the cross-process case needs the `LockService`
abstraction and is recorded, unsolved, in `doc/decision/0051-*` — along with the operational
consequence that Okta refresh-token rotation should stay off until then.

### The endpoint and the client authentication method are discovered, not configured

`AUTH_OKTA_ISSUER` is the only Okta URL in the environment, and the refresher reads
`${issuer}/.well-known/openid-configuration` for `token_endpoint` — the same document the
API's JWKS lookup uses (Task 11). It also reads `token_endpoint_auth_methods_supported` and
picks HTTP Basic or form-body client authentication accordingly: Okta registers web apps with
`client_secret_basic`, while the Auth.js rotation guide hard-codes Google's
`client_secret_post`. Both details are what let dev, e2e (`mock-oauth2-server`) and production
run the same code with only the env value differing. See `doc/decision/0045-*`.

### Failing closed, and never logging a token

A failed refresh does not surface as a silent 401. `isAuthorized` (the middleware callback)
returns `false` for a session in that state, so the request is redirected to the sign-in page;
`useRequireAuth` calls `signOut` on the client, clearing the dead cookie rather than signing
in on top of it. `TokenRefreshError` carries only the HTTP status and the OAuth2 `error` /
`error_description` fields — a test feeds the endpoint an error body that echoes both tokens
back and asserts neither appears in the message. Nothing in the lib calls `console.*`
(`no-console` is an error for `libs/**`).

### No test backdoor

There is no `if (isTest)`, no bypass flag and no credentials provider. The one seam is
`AuthOptions.fetch`, forwarded to the refresher — the same seam `ApiClientOptions.fetch`
already is. It replaces the HTTP transport; nothing it can be set to invents a session, skips
a signature check, or changes which provider is registered. The discovery cache is per
refresher rather than module-global precisely so that no test-only reset hook was needed.

### Tests

| file                   | what it verifies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refresh.spec.ts`      | the discovery URL (and a trailing slash on the issuer), the document cached once but not when it failed, Basic vs. form-body client auth, the `refresh_token` grant, `expires_in` → absolute expiry, a rotated vs. preserved refresh token, error mapping, and that neither token appears in the error message                                                                                                                                                                                                                        |
| `config.spec.ts`       | seeding at sign-in; a healthy token untouched with no provider call; **renewal while the token is still valid**; renewal after expiry; a failed renewal dropping the token; no refresh token → fail closed; a failed session not retried; `projectSession` never emitting the refresh token and unable to leave a stale access token; `isAuthorized` in all three states; provider id, PKCE + state checks, `offline_access`, `strategy: 'jwt'`, no adapter; plus two runs of the configured `jwt` callback with only `fetch` stubbed |
| `access-token.spec.ts` | the provider on its own, and three cases driving a **real** `createApiClient`: the token arrives as `Bearer …`, an absent session sends no header at all, and the header disappears the moment the refresh fails                                                                                                                                                                                                                                                                                                                      |
| `client.spec.tsx`      | against the **real** `SessionProvider`/`useSession`: stable provider identity, no browser storage, polling picking up a renewed token, and `useRequireAuth` signing in, signing out, redirecting once, and doing neither while loading                                                                                                                                                                                                                                                                                                |
| `create-auth.spec.ts`  | the v5 `{ handlers: { GET, POST }, auth, signIn, signOut }` shape really constructs, and constructs with every `AUTH_*` variable deleted                                                                                                                                                                                                                                                                                                                                                                                              |

### No allow-list change

`NPM_ALLOWLIST.util` is generated from `WRAPPED_LIBRARIES`, which already contained
`next-auth`, so this task added **nothing** to `eslint.config.mjs`. `@auth/core` was
deliberately not allow-listed either: every type this lib needs is re-exported by `next-auth`
itself (`Session`, `Account`, `NextAuthConfig`) or by `next-auth/jwt` (`JWT`).

## `libs/garage/realtime-client` — Socket.io (Task 21)

`@garage/realtime-client` is the only place in the workspace allowed to import
`socket.io-client`, and within it, exactly one file does: `src/lib/socket.ts`. It is a
**type:util, scope:web** lib with one entry point.

Everything a feature needs to watch a day, hold a cell or read a broadcast is re-exported,
and every event name and payload type is derived from `@garage/contract/realtime` — so
there is no way to emit or listen for something the contract does not declare, and no payload
shape written down twice.

| export                | what it is                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RealtimeProvider`    | the one connection, in context. Rendered once, in `apps/garage/web`'s provider boundary                                                                                                   |
| `useRealtime`         | **reads** the connection — `{ status, reconnect, reportInvalidPayload }`. Throws outside a provider rather than silently doing nothing                                             |
| `RealtimeStatus`      | `connecting \| connected \| disconnected \| rejected`. `rejected` is a refused handshake: terminal for that socket, and the one status a UI can offer an action on (`reconnect()`) |
| `useRealtimeEvent`    | one server → client event, payload already parsed against its contract schema                                                                                                      |
| `useDayRoom`          | joins one day's room, and rejoins it after every reconnect                                                                                                                         |
| `useCellLock`         | the editing hold: take, renew, release                                                                                                                                             |
| `AccessTokenProvider` | re-exported from `@garage/api-client`, not redeclared — see below                                                                                                               |

**One creator, and it is not exported at all.** `useRealtimeConnection` — the hook that builds
the socket, owns its lifetime and tears it down — stays module-scoped, so `RealtimeProvider`
is the only way to open a connection. That is a stronger version of the guarantee the barrel
used to state as "one creator, one reader": a feature cannot open a second connection by
rendering a component twice, and now it cannot open one at all without going through the
provider.

`createRealtimeSocket`, `toHandshakeAuth`, `parseServerEvent`, `parseAck`, the cell-lock
timing constants and the two delay functions are withheld for the same reason, plus a sharper
one: they traffic in `socket.io-client`'s `Socket`, which is the single object this whole
wrapper exists to keep out of `apps/garage/web`. The ESLint ban is on the **import**, and a
re-exported type walks straight past it — publishing the factory would have handed the app the
banned object through the front door. The lib's own specs reach all of it through
`./lib/socket`, `./lib/connection`, `./lib/validation` and `./lib/timing`.

`useRealtime` returns `RealtimeConnection`, which does **not** name the socket. The provider
still puts one into context at runtime — `RealtimeInternals` is what the hooks inside this lib
actually read — but neither that interface nor `useRealtimeInternals` leaves the barrel, so
app code has no type to cast to and no hook to reach it with. Every consumer in `apps/garage/web`
destructures `status` and `reconnect` and nothing else, which is what the narrower type now
says out loud.

### Usage

```tsx
'use client';

export function Providers({ children }: { children: ReactNode }) {
  const getAccessToken = useAccessTokenProvider();       // @garage/auth/client
  const { status } = useSession();

  return (
    <RealtimeProvider
      url={apiOrigin}
      getAccessToken={getAccessToken}
      enabled={status === 'authenticated'}
      onInvalidPayload={(report) => logger.warn(report, 'realtime payload rejected')}
    >
      {children}
    </RealtimeProvider>
  );
}

// anywhere below it
useDayRoom(date);
useRealtimeEvent('reservation:created', ({ parkingSpotId, reservation }) => { … });
const { status, lockedBy } = useCellLock({ date, parkingSpotId, enabled: isFormOpen });
```

`doc/realtime.md` is the full client-side reference — the handshake, rooms, parsing, and the
cell lock's three guarantees. Only what is specific to _being a wrapper_ is repeated here.

### The token seam is imported, not redeclared

`AccessTokenProvider` is defined once, in `libs/shared/api-client`, and both `libs/garage/auth` (which
produces one) and `libs/garage/realtime-client` (which consumes one) import it from there. That is
deliberate: the HTTP client and the socket must not drift into two different ideas of what
the seam is, because the drift that matters — "the socket takes a string, the client takes a
function" — is exactly what would make a long-lived socket pin an expired token.

It is an `import type`, so nothing from `@orpc` reaches the realtime bundle or the Jest
runtime. It does create a workspace edge (`realtime-client → api-client`), which
`type:util → type:util` permits and which forms no cycle: `libs/garage/auth` also depends on
`libs/shared/api-client`, and `libs/garage/realtime-client` does not depend on `libs/garage/auth`.

### No allow-list change, and no `eslint.config.mjs` change at all

`WRAPPED_LIBRARIES` already named `libs/garage/realtime-client` as `socket.io-client`'s owner, so
both the global ban and this lib's exemption were generated before the lib existed. Nothing
was added to `NPM_ALLOWLIST`, and `libs/garage/realtime-client/eslint.config.mjs` is the generator's
default — it sets **no** `no-restricted-imports` of its own, so the root's copy is not
replaced. (That rule is a single rule: a lib-local config that sets it wins outright and
silently switches the wrapper ban off for that lib. Every block in
`libs/shared/design-system/eslint.config.mjs` spreads `restrictWrappedLibraries().patterns`
back in for exactly that reason.)

`socket.io-parser` was **not** allow-listed either, although the test fixture needs
Socket.io's numeric packet type codes to feed an inbound packet — CONNECT_ERROR included, and
that one the client never sends. It discovers them from the installed client instead: the
three the client emits by reading them off its own output, and CONNECT_ERROR by the pair of
effects only it has (`doc/decision/0061-*`).

### Five probes, all exercised

Read the config and you learn what it says; run it and you learn what it does. All five
probe files were written, linted, and deleted.

| probe                                                                  | expected                  | result                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `libs/garage/realtime-client/src/probe-owner.ts` imports `socket.io-client`   | passes                    | `Successfully ran target lint for project realtime-client`                                                          |
| `libs/query/src/lib/probe-outsider.ts` imports it                      | fails, naming the wrapper | `Do not import "socket.io-client" directly — use the wrapper lib @garage/realtime-client (libs/garage/realtime-client)` |
| `apps/garage/web/src/probe-app.ts` imports it                                 | fails, naming the wrapper | same message                                                                                                        |
| `libs/garage/realtime-client/src/probe-allowlist.ts` imports `axios`          | fails                     | `A project tagged with "type:util" is not allowed to import "axios"`                                                |
| `libs/garage/realtime-client/src/probe-nextauth.ts` imports `next-auth/react` | fails, naming `libs/garage/auth` | `Do not import "next-auth" directly — use the wrapper lib @garage/auth (libs/garage/auth)`                              |

The fourth is the one that would have caught an untagged lib — an untagged project is
constrained by nothing. The fifth is the one that proves the per-wrapper override really is
`restrictWrappedLibraries(['socket.io-client'])` and not a blanket exemption: every _other_
wrapped package is still banned inside this directory.

### Tests

60 tests. The socket in all of them is a **real** `socket.io-client` socket: only the
transport is replaced (`manager.open()` → no-op, `manager._packet()` → capture), while
`Socket.onopen`, `Socket.onpacket`, `Socket.onclose`, `emit`'s buffering and the
acknowledgement registry run the library's own code, driven through the manager's real
`open` / `close` / `packet` events — which is what `Socket.subEvents()` subscribes to. A
reconnect in these tests is the same event the reconnect timer fires in production.

Even the numeric packet type codes are **discovered rather than written down**:
`discoverPacketTypes()` makes the installed client emit a CONNECT (by opening), an EVENT (by
emitting) and an ACK (by acknowledging an inbound event carrying an id), and reads the codes
off its own output. Hard-coding `2` for EVENT would have been a number the fixture believes
that nothing checks — and it is why no `socket.io-parser` allow-list entry was needed.

| file                  | what it verifies                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `socket.spec.ts`      | the token in the CONNECT packet and nowhere else (no `query`, no `extraHeaders`, no `?` in the URI); **re-read on every reconnect**; an async provider awaited; `{}` — not `{ token: undefined }` — for no session and for a rejected provider                                                                                                                                                                        |
| `connection.spec.tsx` | one socket, its status transitions, disconnect on unmount; `useRealtimeEvent` **parsing** (a bad `waitlistCount` and a bad uuid dropped and reported, undeclared keys stripped, unsubscribe on unmount); `useDayRoom` joining, **rejoining after a reconnect**, and swapping rooms; `useRealtime` throwing outside a provider                                                                                         |
| `cell-lock.spec.tsx`  | `renewDelayMs` (half the TTL, the floor, and never `NaN`); the request on connect; **the heartbeat**, and that it does not fire early; **release on unmount**, on `enabled: false` and on a cell change; the heartbeat stopped with the component; no release for a hold never acquired; no polling of a contended cell; re-acquisition after a reconnect; a schema-failing ack dropped rather than scheduled on      |
| `validation.spec.ts`  | every registered event accepted, rejected as a non-object, and rejected on a broken cell ref — driven by the contract registry, with an exhaustive `Record<ServerToClientEventName, unknown>` payload table that stops compiling if the contract grows an event; ack parsing; the report carrying paths and messages but nothing from the payload; and this file's own source containing no `socket.io-client` import |

Each of the four behaviours the task brief names was **mutation-checked**: the behaviour was
deleted, the suite run, and the failure recorded. Removing the `auth` callback's re-read
makes the reconnect test report `"token": "jwt-first"` where `"jwt-second"` was expected;
removing the renewal timer, the release emit, and `parseServerEvent` each fail their tests
(1, 4 and 3 tests respectively).

> **A finding from writing that third test.** Unmounting the _whole_ tree emits no
> `cell:unlock` — React runs a deletion's cleanups parent-first, so the provider has already
> disconnected the socket. That is not a leak (a dropped socket is how the gateway frees a
> hold, and it is the path a closed tab takes), but it does mean the emit is guaranteed for
> the case that matters — a form closing on a live page — and redundant for the case it is
> not. The test was restructured onto the real scenario; `connection.spec.tsx` covers the
> other half by asserting the socket is closed. Recorded in `cell-lock.ts` and
> `doc/realtime.md`.

### No ESM-transform block, and that is a finding

The block `doc/decision/0020-*` describes was **not** copied a sixth time, because nothing on
this lib's runtime path is ESM-only: `socket.io-client` 4.8.3 is `"type": "commonjs"` with
both conditions, `zod` is dual, and `@garage/contract/realtime` is deliberately free of
`@orpc` — which `libs/garage/contract/src/realtime/no-orpc.spec.ts` enforces, and which this Jest
config is a second, independent consequence of. `tsconfig.spec.json` does drop the
generator's `module: commonjs`, the same way `libs/garage/auth`'s and `libs/query`'s do
(`doc/decision/0038-*`): _type_ resolution reaches `@orpc/client` through
`@garage/api-client`, and that package has no `require` condition.

---

## `libs/garage/calendar-export` — `ical-generator` (Task 14)

The only wrapper on the **backend** side of the workspace (`scope:api`), and the only one whose
consumer is `apps/garage/api` rather than `apps/garage/web`.

```ts
import { buildReservationCalendar } from "@garage/calendar-export";

const ics: string = buildReservationCalendar({ entries }); // entries: IcsCalendarEntry[]
```

That is the entire public surface a caller needs: contract values in, an RFC 5545 document out.
`ical-generator` does not appear in the signature, in the types, or in `apps/garage/api` at all — which is
the property step 4 of the recipe above asks for, and `calendar-pipeline.spec.ts` is the running
example of it (a real HTTP response, built through the wrapper, parsed by an independent library).

The only other exports are the two pieces a caller legitimately needs to _assert_ on:
`ICS_CALENDAR_NAME` and `icsEventUid`. `apps/garage/api`'s calendar pipeline suite reads a rendered
feed back and has to name what it expects to find in it; writing those two out a second time
there is how a test starts passing against the wrong document.

`ICS_REFRESH_INTERVAL_SECONDS`, `ICS_UID_DOMAIN`, `icsEventSummary` and `icsEventDescription`
stay module-scoped. They are how the document is built, not what a caller asks for, and the
lib's own spec imports them from `./lib/reservation-calendar` already — a caller that wanted
one of them would be reimplementing `buildReservationCalendar` rather than using it.

### What the wrapper is actually protecting against

Not "a few characters of import". Two concrete, measured things:

1. **`ical-generator`'s `timezone` option is a trap.** Setting `timezone: 'Europe/Prague'` on the
   calendar — which reads as obviously correct for this application — makes the rendered dates
   depend on the **server's** `TZ`: under `TZ=America/Los_Angeles` a reservation for `2026-10-15`
   comes out as `DTSTART;VALUE=DATE:20261014`, and `DTSTAMP` loses its `Z`. One place to get that
   right is much better than several. `doc/decision/0081-*` has the full table.
2. **`DTSTAMP` defaults to "now"**, which would make the feed non-deterministic and silently
   disable the `ETag`/`304` path the endpoint depends on. The wrapper sets it from the
   reservation's `createdAt` instead.

### Tests

`libs/garage/calendar-export/src/lib/reservation-calendar.spec.ts`, 19 tests. Every assertion reads the
output back through **`ical.js`** — Mozilla's RFC 5545 parser, a devDependency added for exactly
this and allowed only in this lib's spec files (`calendarExportSpecDepConstraints`). A test that
compares a generator's output to a template written by the same author proves the template equals
itself.

The three kinds the recipe asks for:

| kind                                  | where                                                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the wrapper can be used               | the whole suite calls `buildReservationCalendar` through `@garage/calendar-export`'s public API                                                                                                                     |
| it behaves according to what it wraps | RFC 5545 conformance: mandatory `VERSION`/`PRODID`, `VALUE=DATE` bounds with an exclusive `DTEND`, `TEXT` escaping of `,` `;` `\`, 75-octet line folding under Czech diacritics, and a parse → re-serialise round trip |
| app code needs no direct import       | `apps/garage/api/src/calendar/` contains no `ical-generator` import; `calendar-pipeline.spec.ts` fetches the real endpoint and parses the bytes                                                                               |

Two extras that are specific to this wrapper:

- **A cross-time-zone check in child processes.** Flipping `process.env.TZ` inside a Jest test does
  not work _and does not fail_: `jest-environment-node` gives each file a `process` whose `env` is a
  copy, so the assignment never reaches the real environment ICU reads, and the test passes without
  having changed anything. Found because the first draft carried a sanity check comparing the local
  hour under two zones — and the sanity check is what failed. The suite now renders the same feed in
  four `node` child processes pinned to `UTC`, `America/Los_Angeles`, `Europe/Prague` and
  `Pacific/Kiritimati` and asserts one distinct output.
- **A purity check with the clock moved.** `ical-generator` formats `DTSTAMP` to whole seconds, so
  two calls in a row are identical even when the builder reads `new Date()`. The test moves the
  system time between them.

### The boundary, probed

Step 5 of the recipe, in both directions. Inside `libs/garage/calendar-export`, `import ical from
'ical-generator'` lints clean. From `apps/garage/api/src/probe/` and from `libs/shared/form/src/lib/`, the same
line produces:

```
error  'ical-generator' import is restricted from being used by a pattern.
Do not import "ical-generator" directly — use the wrapper lib @garage/calendar-export
(libs/garage/calendar-export). Only libs/garage/calendar-export may import "ical-generator"
no-restricted-imports
```

The scope boundary was probed too, since this is the first `scope:api` wrapper and nothing had
exercised that direction: `libs/garage/calendar-export` importing `@garage/i18n`, and `apps/garage/web`
importing `@garage/calendar-export`, both fail with
`A project tagged with "scope:api" can only depend on libs tagged with "scope:api", "scope:shared"`
and its `scope:web` mirror. All probe files were deleted.

**No `eslint.config.mjs` edit was needed for the ban itself.** `WRAPPED_LIBRARIES` already named
`ical-generator` with `owner: libs/garage/calendar-export`, and `NPM_ALLOWLIST.util` already contained it
through the `Object.keys(WRAPPED_LIBRARIES).flatMap(...)` spread.

What _was_ added is the test-only reader, `ical.js` — and where it goes matters. Step 3 of the
recipe says to put a package on the tag's allow-list, and the first draft did: one line on
`NPM_ALLOWLIST.util`. But that list applies to **every** `type:util` project at once, so the entry
also handed an RFC 5545 parser to the shipped source of six unrelated wrapper libs. It is now
scoped to `libs/garage/calendar-export/**/*.spec.ts` via `calendarExportSpecDepConstraints`, the same
shape `libs/shared/form` already uses for its own test-only widening. Probed in both directions:

```
# libs/garage/calendar-export/src/lib/reservation-calendar.ts — shipped source
error  A project tagged with "type:util" is not allowed to import "ical.js"
       @nx/enforce-module-boundaries

# libs/garage/calendar-export/src/lib/reservation-calendar.spec.ts — unchanged
Successfully ran target lint for project calendar-export
```

Follow the scoped form for the next test-only package too. Step 3's tag-wide list is right for a
package the whole tag legitimately uses (`tslib`, `react`); it is wrong for one that only ever
appears in a spec, and `@testing-library/*` sits on `NPM_ALLOWLIST.ui`/`.util` today only because
those specs are spread across many projects rather than one.

The lib-local `eslint.config.mjs` is a bare `[...baseConfig]`. That is deliberate: `baseConfig`
already contains the generated per-wrapper override, and a lib-local
`no-restricted-imports` would have **replaced** the root's copy outright and switched the whole
wrapper ban off for this lib — the hazard `restrictWrappedLibraries` is exported to avoid.
