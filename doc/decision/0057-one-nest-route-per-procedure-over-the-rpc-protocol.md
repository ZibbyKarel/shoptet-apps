# 0057 – One Nest route per procedure over oRPC's RPC protocol, not `@orpc/nest`'s `@Implement`

**Date:** 2026-09-02 · **Status:** accepted · **Follows on from:** `doc/decision/0039-*`,
`doc/decision/0040-*`, `doc/decision/0041-*`

## What

`apps/garage/api` serves the contract from Task 4 as **one `@Post()` Nest route per contract
procedure**, each delegating to a single shared `RPCHandler` from `@orpc/server`:

- `apps/garage/api/src/orpc/rpc-route.ts` derives the path — `/api/rpc/<segment>/<segment>`, so
  `admin.spot.create` is `POST /api/rpc/admin/spot/create`.
- `apps/garage/api/src/orpc/rpc-route-handler.ts` owns the one `RPCHandler`, mounted with
  `prefix: '/api/rpc'`, and turns an unmatched path into a `NotFoundException`.
- `apps/garage/api/src/orpc/implementer.ts` is `implement(contract).$context<OrpcContext>()` plus the
  error-mapping middleware; every procedure is built from it, so the input and output schemas
  are the contract's own and cannot drift.
- The controller method carries the Nest decorators: `@Roles('ADMIN')` where the contract
  namespace is `admin.*`, and `@CurrentUser()` to get the `AuthenticatedUser` that becomes the
  oRPC context.

The task brief named `@orpc/nest`'s `@Implement` decorator. **That package is not installed and
is not used.** The only new dependency is `@orpc/server@1.15.0`, already a transitive dependency
of `@orpc/contract`.

`apps/garage/api/src/orpc/orpc-route-parity.spec.ts` is what keeps this honest: it walks the contract
router and, for every procedure, asserts a Nest route exists at the derived path (or is listed in
`NOT_YET_IMPLEMENTED` for Tasks 13 and 17), that it is a `POST`, and that its `@Roles` metadata
is `['ADMIN']` for exactly the `admin.*` namespace and absent everywhere else.

## Why

**`@Implement` speaks a different wire protocol than the client we have already merged.** oRPC
has two: the **RPC protocol** (`RPCLink`/`RPCHandler`, a `{ json, meta }` envelope, `POST` to
`/rpc/<procedure/path>`) and the **OpenAPI protocol** (`@orpc/nest`, REST-shaped paths and
methods, bare JSON bodies). `@Implement` only serves the second.

`libs/shared/api-client` (Task 19, merged) builds its client with `RPCLink` from `@orpc/client/fetch`,
and its spec asserts the exact request an `apps/garage/web` call produces:
`https://api.test/rpc/reservation/create` with body `{ json: { … } }`. `libs/query`'s fixtures
(`libs/query/src/__fixtures__/stub-api.ts`) build responses the same way. Adopting `@Implement`
would have meant:

1. a new npm package (`@orpc/openapi-client`) for the frontend link, and an `NPM_ALLOWLIST`
   widening in `eslint.config.mjs` for the `util` tag to permit it;
2. rewriting merged, passing tests in two libraries to assert a different URL shape and a
   different body;
3. deciding a REST method and path for each of the 20 procedures — information the contract does
   not carry, so it would have been invented in `apps/garage/api` and duplicated in the client.

None of that is work Task 12 was asked to do, and (1) is exactly the kind of allowlist widening
"arriving as a side effect" the task constraints call a finding. The RPC protocol is what the
contract's two existing consumers already speak; the server was the only half not yet written, so
the server is the half that conforms.

**Why one route per procedure rather than one wildcard route.** A single `@All('rpc/*path')`
handler would be fewer lines, and `RPCHandler` would route inside it perfectly well. It would
also put every procedure behind one Nest route — and Nest's authorization metadata is attached
to routes. `@Roles('ADMIN')` on a wildcard route applies to all 20 procedures or to none.
The alternative is an authorization check inside the oRPC middleware, keyed off the procedure
path: a **second** authorization mechanism, which the task constraints forbid and which would
leave `doc/auth.md` describing a decorator that no longer decides anything.

With one route per procedure, `@Roles('ADMIN')`, `@Public()` and `@CurrentUser()` keep working
exactly as Task 11 documented them, `RolesGuard` runs before the handler, and the routing table
is visible to `Reflect.getMetadata` — which is what makes the parity spec possible at all.

**Why the handler is shared.** `RPCHandler` builds and caches its procedure lookup from the
router it is constructed with. Constructing one per route would parse the router 20 times for no
benefit; constructing one and mounting it with a prefix means every route decodes, validates and
serialises through the same codec, so the wire format cannot drift between two procedures.

## Consequences

- Adding a procedure to the contract is **two** edits in `apps/garage/api`: the oRPC implementation, and
  a `@Post(rpcRoute(…))` method on a controller. Forgetting the second is a failing parity spec,
  not a 404 discovered in the browser.
- A path the contract declares but no route serves answers **404**, not 501 — `RPCHandler`
  reports `matched: false` and the route handler throws `NotFoundException`. The six procedures
  Tasks 13 and 17 own behave this way today, and `orpc-pipeline.spec.ts` asserts it for
  `reservation.create`.
- `@orpc/nest` remains a reasonable choice for a future public REST surface; it would sit
  alongside this one on different paths rather than replacing it, because a contract can be
  served by both handlers at once.
- Should the frontend ever need the OpenAPI protocol, this is the decision to revisit, and the
  cost is the three items listed above — not a rewrite of the domain services, which know nothing
  about either protocol.
