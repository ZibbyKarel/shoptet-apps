# 0101 – Three endpoints are derived from one API URL, and none of them is it

## What

`NEXT_PUBLIC_API_URL` (`http://localhost:3000/api`) is the API's base URL. The
web app talks to three endpoints on that deployment and **none of them is the
configured value itself**. `apps/garage/web/src/api-url.ts` derives all three:

| Consumer | Derivation | Example |
|---|---|---|
| oRPC client | `apiRpcUrl` — base + `/rpc` | `http://localhost:3000/api/rpc` |
| readiness probe | `apiReadinessUrl` — origin + `/health/ready` | `http://localhost:3000/health/ready` |
| Socket.io | `apiOriginOf` — origin only | `http://localhost:3000` |

## Why

Each of the three has a specific, silent way of being wrong, and one of them
*was* wrong until a browser said so.

- **`/rpc` is not optional.** `MeController` is `@Controller('rpc')` under the
  global prefix, and `RPCLink` appends only the procedure's key path to the
  base URL it is given. Handing it the configured value calls
  `POST /api/me/get`, which does not exist. Measured against the running API:
  `POST /api/me/get` → `404`, `POST /api/rpc/me/get` → `401` (route present,
  guard ran). **`doc/auth.md`'s illustrative snippet has this bug**
  (`createApiClient({ url: env.NEXT_PUBLIC_API_URL, … })`), and so did this app
  until the first signed-in page was actually loaded — a unit test that stubs
  `fetch` cannot catch a wrong URL, because a stub answers whatever it is given.
- **The health probes are outside the prefix.** `configureApp()` passes the
  health prefix to `setGlobalPrefix`'s `exclude`, so they sit at the server
  root. Measured: `/health/ready` → `200`, `/api/health/ready` → `404`. Getting
  this wrong yields a health page that is red on a perfectly healthy
  deployment — a failure mode that reads as "the deployment is down".
- **Socket.io reads a path as a namespace, not as a mount point.**
  `io('http://host/api')` dials the `/api` *namespace*, which the gateway does
  not register; the handshake is refused in a way that looks like an auth
  failure. `RealtimeSocketOptions.url` is documented as the API's **origin**
  precisely for this, and the mount point is its separate `path` option.
  `doc/realtime.md`'s example passes `NEXT_PUBLIC_API_URL` directly and is
  wrong for the same reason.

Deriving rather than configuring is the second half of the decision: three env
variables for one deployment can drift from each other, and the drift shows up
as one of the three silent failures above. One variable cannot drift from
itself.

## How

- `API_RPC_SEGMENT` mirrors `RPC_ROUTE_PREFIX` in
  `apps/garage/api/src/orpc/rpc-route.ts` by value, not by import. The module boundary
  keeps `apps/garage/web` out of `apps/garage/api`, and rightly — a shared constant would
  make the client the authority on a server mount point. The two are kept
  honest by `api-url.spec.ts` and by exercising a real request.
- `apiOriginOf` throws on a relative URL rather than returning something
  plausible; `env.ts` validates the variable with `z.url()` first, so a throw
  means the schema was bypassed.
- Mutating each derivation kills tests (4, 3 and 2 respectively). Mutating the
  *wiring* in `ApiProvider` kills none — recorded openly in the Task 23 report
  rather than papered over.

## Risk

- **The `/rpc` segment is duplicated knowledge.** If the API ever moves its RPC
  mount, `API_RPC_SEGMENT` has to move with it and only a running request will
  say so. The alternative — publishing the segment from `libs/garage/contract` — is a
  reasonable future change, but the contract currently describes procedures,
  not transports, and putting a Nest routing detail in it would be worse.
- **`ApiProvider`'s use of the derivation is unspecced** (see above). A live
  smoke test in the e2e suite (Fáze 7) is the natural home for it.
