---
name: orpc-contract-first
description: Use when designing, implementing, refactoring, or reviewing an oRPC API with contract-first architecture, especially in a TypeScript monorepo. Trigger when the user mentions oRPC contracts, `@orpc/contract`, `implement(contract)`, shared API contracts, monorepo API packages, OpenAPI-to-oRPC generation, router-to-contract migration, or keeping web/client and API/server apps type-safe through a shared package. This skill guides agents to put contracts and schemas in a dedicated shared package, keep business logic out of the contract, implement contracts from server packages/apps, and wire clients without leaking server internals.
---

# oRPC contract-first

Build oRPC APIs where the contract is the shared source of truth. In a monorepo, put the contract in a dedicated package that both API implementations and clients can import. Keep runtime business logic, database code, request handlers, environment access, and framework adapters out of that package.

Primary docs to prefer when details change:

- `https://orpc.dev/docs/contract-first/define-contract`
- `https://orpc.dev/docs/contract-first/implement-contract`
- `https://orpc.dev/docs/contract-first/router-to-contract`
- `https://orpc.dev/docs/openapi/openapi-to-contract`
- `https://orpc.dev/docs/best-practices/monorepo-setup`

## Core model

Use this mental split:

- **Contract package**: defines schemas, procedure contracts, contract routers, exported inferred input/output types, and optionally generated OpenAPI-derived contracts.
- **Server package/app**: imports the contract, calls `implement(contract)`, attaches `.handler(...)` implementations, builds the root `os.router(...)`, and exposes the API through framework adapters.
- **Client app/package**: imports the contract for type-safe clients/links, query helpers, generated client utilities, or request method typing. It must not import server procedures or implementation modules.

The contract package is an interface artifact. Treat it like a public API package inside the workspace.

## Recommended monorepo layout

Prefer one of these structures unless the repo already has a stronger convention.

Contract-first:

```txt
apps/
  api/        # imports @repo/contracts and implements it
  web/        # imports @repo/contracts and configures @orpc/client
packages/
  contracts/
    src/
      schemas/
      contract.ts
      index.ts
```

Hybrid split, useful when implementation is reused by multiple runtimes:

```txt
apps/
  api/        # imports @repo/core-service and mounts framework adapter
  web/        # imports @repo/contracts and configures @orpc/client
packages/
  contracts/      # @orpc/contract only, schemas, route metadata
  core-service/   # imports contract, uses @orpc/server, exports router/procedures
```

Use TypeScript project references for cross-package type safety. Packages that are consumed by apps should generally set `"composite": true`; consuming apps should reference the relevant package or rely on the workspace's established build graph. Avoid path aliases inside shared server/contract components when workspace package imports are available.

## Contract package rules

When creating or editing the shared contract package:

1. Import `oc` from `@orpc/contract`; do not import `os` or server adapters.
2. Define validation schemas near the contracts that use them, or in domain-oriented `schemas/` files if reused.
3. Export a root `contract` object that mirrors the API domain hierarchy.
4. Export inferred types with `InferContractRouterInputs` and `InferContractRouterOutputs` when consumers need stable named types.
5. Keep the package free of database clients, auth/session lookup, framework request objects, environment variables, and service classes.
6. Prefer domain names over transport names: `planet.find`, `invoice.create`, `account.members.list`.
7. Use route metadata only for public API description concerns such as OpenAPI routes, method/path, tags, and summaries. Do not smuggle implementation choices into metadata.

Example shape:

```ts
import { oc } from '@orpc/contract'
import type {
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from '@orpc/contract'
import { z } from 'zod'

export const PlanetSchema = z.object({
  id: z.number().int().min(1),
  name: z.string(),
  description: z.string().optional(),
})

export const contract = {
  planet: {
    list: oc
      .input(z.object({
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).default(0),
      }))
      .output(z.array(PlanetSchema)),
    find: oc
      .input(PlanetSchema.pick({ id: true }))
      .output(PlanetSchema),
    create: oc
      .input(PlanetSchema.omit({ id: true }))
      .output(PlanetSchema),
  },
}

export type ContractInputs = InferContractRouterInputs<typeof contract>
export type ContractOutputs = InferContractRouterOutputs<typeof contract>
```

## Server implementation rules

When implementing the contract:

1. Import `implement` from `@orpc/server` and the shared `contract` from the contract package.
2. Create the implementer once near the server's oRPC composition root: `const os = implement(contract)`.
3. Implement each procedure by attaching `.handler(...)` to the corresponding contract path.
4. Build the root router with `os.router(...)`; this is the step that type-checks and enforces the full contract at runtime.
5. Keep framework adapters and transport concerns outside the contract package.
6. Use context/middleware from the server layer for auth, database access, tracing, and per-request dependencies.

Example shape:

```ts
import { implement } from '@orpc/server'
import { contract } from '@repo/contracts'

const os = implement(contract)

const listPlanet = os.planet.list.handler(async ({ input, context }) => {
  return context.planets.list(input)
})

const findPlanet = os.planet.find.handler(async ({ input, context }) => {
  return context.planets.find(input.id)
})

const createPlanet = os.planet.create.handler(async ({ input, context }) => {
  return context.planets.create(input)
})

export const router = os.router({
  planet: {
    list: listPlanet,
    find: findPlanet,
    create: createPlanet,
  },
})
```

If a handler cannot satisfy the contract output, fix the implementation or the contract deliberately. Do not cast around the mismatch; the mismatch is the contract doing its job.

## Client consumption rules

Clients should import the shared contract package, not server implementation modules.

Use the contract for:

- `ContractRouterClient<typeof contract>` typing.
- `RPCLink` clients for oRPC RPC endpoints.
- `OpenAPILink` clients for OpenAPI-style endpoints generated/exposed from the contract.
- Generated query/mutation helpers.
- Named input/output types exported from the contract package.
- Mock clients in tests or Storybook-style environments.

Minimal RPC client:

```ts
import { createORPCClient, onError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { contract } from '@repo/contracts'

const link = new RPCLink({
  url: '/rpc',
  headers: () => ({
    authorization: `Bearer ${getAccessToken()}`,
  }),
  interceptors: [
    onError((error) => {
      reportClientError(error)
    }),
  ],
})

export const orpc: ContractRouterClient<typeof contract> = createORPCClient(link)
```

Calling procedures should look like plain function calls:

```ts
const planets = await orpc.planet.list({ limit: 20 })
const planet = await orpc.planet.find({ id: 1 })
```

Use client context when headers, cache behavior, or tenancy differ per call:

```ts
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { contract } from '@repo/contracts'

interface ClientContext {
  accessToken?: string
  cache?: RequestCache
}

const link = new RPCLink<ClientContext>({
  url: '/rpc',
  headers: ({ context }) => ({
    authorization: context?.accessToken ? `Bearer ${context.accessToken}` : '',
  }),
  fetch: (request, init, { context }) => {
    return globalThis.fetch(request, {
      ...init,
      cache: context?.cache,
    })
  },
})

export const orpc: ContractRouterClient<typeof contract, ClientContext> =
  createORPCClient(link)

await orpc.planet.list(
  { limit: 20 },
  { context: { accessToken, cache: 'force-cache' } },
)
```

When contract routes specify HTTP methods, prefer deriving the RPC request method from the shared contract instead of repeating method logic in the client:

```ts
import { inferRPCMethodFromContractRouter } from '@orpc/contract'
import { RPCLink } from '@orpc/client/fetch'
import { contract } from '@repo/contracts'

const link = new RPCLink({
  url: '/rpc',
  method: inferRPCMethodFromContractRouter(contract),
})
```

For extra boundary checks in contract-first clients, add request and/or response validation plugins at the link layer. This works best with real contracts because minified contracts remove schemas.

```ts
import { RPCLink } from '@orpc/client/fetch'
import {
  RequestValidationPlugin,
  ResponseValidationPlugin,
} from '@orpc/contract/plugins'
import { contract } from '@repo/contracts'

const link = new RPCLink({
  url: '/rpc',
  plugins: [
    new RequestValidationPlugin(contract),
    new ResponseValidationPlugin(contract),
  ],
})
```

For OpenAPI clients, pass the contract into `OpenAPILink` and type the client from the contract. Account for JSON serialization limitations when the link requires jsonified client types.

```ts
import { createORPCClient } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { contract } from '@repo/contracts'

const link = new OpenAPILink(contract, {
  url: '/api',
})

export const api: JsonifiedClient<ContractRouterClient<typeof contract>> =
  createORPCClient(link)
```

Avoid:

- Importing `router`, procedures, database types, or server context into web/mobile clients.
- Putting client-only helpers into the contract package if they pull in browser framework dependencies.
- Duplicating schemas in the client app when they already exist in the contract package.

## Migrating from service/router-first

If an existing codebase already has an oRPC server router:

1. Check whether the router contains lazy routers. If it does, resolve it first with `unlazyRouter(router)` before deriving a contract-compatible router.
2. If the client needs contract data from a server-derived router, use `minifyContractRouter(router)` and export JSON rather than importing the server router directly.
3. Treat minified JSON as a bridge, not the ideal monorepo target. For new work, move stable public API shape into the shared contract package.
4. When importing minified JSON client-side, preserve type safety by casting it to `typeof router` as documented, because schema types are not serializable in JSON.

Use router-to-contract migration when extraction is incremental. The end state should still separate public contract from internal business logic.

## Generating from OpenAPI

If the source of truth is an existing OpenAPI specification:

1. Use `@hey-api/openapi-ts` with the `orpc` plugin to generate an oRPC-compatible contract.
2. Prefer generating into a shared contract package, or into a generated subfolder that the shared package re-exports.
3. Use `validator.input: 'zod'` when the project uses Zod for runtime input validation.
4. Keep generated files isolated from handwritten domain conveniences so regeneration does not overwrite local code.
5. Remember the Hey API `orpc` plugin is documented as beta; pin versions and review generated diffs.

Example config:

```ts
import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: './openapi.json',
  output: 'packages/contracts/src/generated',
  plugins: [
    {
      name: 'orpc',
      validator: {
        input: 'zod',
      },
    },
  ],
})
```

## Package boundaries and dependencies

Use dependency direction as the sanity check:

```txt
apps/garage/web ------------> packages/contracts <------------- apps/garage/api
                                ^
                                |
                         packages/core-service
```

Allowed dependencies:

- `contracts` may depend on `@orpc/contract`, schema libraries such as `zod`, and small type-only/domain packages.
- `core-service` or `apps/garage/api` may depend on `contracts`, `@orpc/server`, database packages, auth packages, and framework adapters.
- `apps/garage/web` may depend on `contracts`, `@orpc/client`, UI/query libraries, and browser framework packages.

Disallowed dependencies:

- `contracts` importing `@orpc/server`, API framework adapters, DB clients, auth/session services, or app-specific config.
- `apps/garage/web` importing `core-service`, server routers, server context, or API app files.
- Server implementation packages importing UI/client packages.

## Implementation checklist

Before finishing an oRPC contract-first change, verify:

- The shared contract package exports the root `contract` and any intended schemas/types.
- Server code uses `implement(contract)` and builds a root `os.router(...)`.
- The client imports the contract package or generated/minified contract artifact, never server internals.
- TypeScript project references or workspace package builds let apps resolve contract types without falling back to `any`.
- Contract package dependency list does not include server-only or client-only runtime dependencies.
- Generated OpenAPI-derived contracts are isolated and reproducible.
- Tests or type checks cover at least one client import path and one server implementation path when the change touches package boundaries.

## Common failure modes

- **Putting handlers in the contract package.** Move them to `core-service` or the API app.
- **Duplicating schemas per app.** Promote shared request/response schemas to the contract package.
- **Importing server routers in the client.** Import the shared contract, or use `minifyContractRouter` JSON for router-derived migration cases.
- **Skipping `os.router(...)`.** Handlers alone do not assemble the fully enforced router.
- **Casting away output errors.** Fix the handler output or contract; do not paper over mismatches.
- **Path-alias-only sharing.** Prefer real workspace package imports so project references and package boundaries remain honest.
