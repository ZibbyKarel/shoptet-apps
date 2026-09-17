# 0058 – Error bodies on `/api/rpc` routes carry the RPC envelope; everywhere else they do not

**Date:** 2026-09-02 · **Status:** accepted · **Follows on from:** `doc/decision/0039-*`,
`doc/decision/0033-*`, `doc/decision/0041-*`

## What

`ContractExceptionFilter` now looks at the request path. On a route under `/api/rpc` it wraps the
body it was already producing in `{ json: … }`; on every other route it writes the body bare, as
before.

```
POST /api/rpc/admin/spot/list   (a USER)  → 403 { "json": { "defined": false, "code": "FORBIDDEN", … } }
POST /api/echo                  (a USER)  → 403 {           "defined": false, "code": "FORBIDDEN", …   }
```

Only the two branches that emit a **contract** body are wrapped — `DomainError` and the mapped
Prisma errors. Transport failures (401, 404, 413, 429, and an unexpected 500) keep Nest's shape
in both cases, unchanged, per `doc/decision/0033-*`.

There is deliberately **no `meta` key**. oRPC's own serialiser omits it when there are no type
annotations to carry (`StandardRPCSerializer#serialize` returns `undefined` for an empty array)
and `@orpc/client` reads it as `data.meta ?? []`. Emitting `meta: []` would make the filter's
output differ, byte for byte, from the handler's for no reason.

## Why

**`doc/decision/0039-*` predicted this defect and routed it here.** Its closing section says the
guard that would catch it "belongs in `apps/garage/api`'s filter spec, asserting the serialised body is
enveloped — a test that fails today". Task 12 is the first task to own `apps/garage/api`'s filter, so
Task 12 pays it.

The concrete failure: `@orpc/client` deserialises a response by reading `body.json`. Handed a
bare `{ code: 'FORBIDDEN', status: 403, … }` it finds no `json` key, falls back to synthesising an
error from the **HTTP status**, and the caller receives a generic error whose `code` was invented
by the transport rather than the one the API actually sent. `libs/shared/i18n` keys its Czech copy off
`code`. So a user forbidden from an admin screen would have seen a generic failure message, and
no amount of correctness in the filter's `code` field would have reached them.

This is invisible to a unit test of the filter that inspects the object it passes to
`response.json(...)` — that object was always right. It is only visible when a real client
deserialises a real response, which is why the assertion lives in `orpc-pipeline.spec.ts` as
well: an ordinary user calling `admin.spot.list` must get `{ json: { code: 'FORBIDDEN' … } }`,
and the neighbouring test asserting a domain error raised *inside* a procedure gets the same
shape from oRPC's own serialiser is what makes the pair meaningful.

**Why the path, and not a marker on the exception.** Where the body must be enveloped is a fact
about the *route* — its client is `RPCLink`, which only ever reads `body.json`. It is not a fact
about the error: the same `DomainError` thrown from a future REST or webhook route must not be
wrapped. Deriving it from `RPC_PATH_PREFIX`, the same constant the handler is mounted with, means
the two cannot disagree; a marker on the exception would have to be set correctly at every throw
site, which is a rule nobody can enforce.

**Why not envelope everything.** The transport failures listed above are answered before any
procedure is entered, and `doc/decision/0033-*` fixed their shape as Nest's. Wrapping them would
be claiming they are contract errors, which is precisely the claim `0033` and `0041` refused.

## Consequences

- `ContractExceptionFilter` now reads the request as well as the response. `createHost()` in its
  spec provides `getRequest`, and the spec asserts both shapes from the same error.
- A new route family that speaks the RPC protocol must be mounted under `/api/rpc` — which
  `rpcRoute()` enforces for every controller — or its errors will lose their codes silently. That
  is the one way this could regress, and the parity spec catches the mounting mistake first.
- The filter's output for `/api/rpc` is now byte-identical to `RPCHandler`'s for the same error,
  so a client cannot tell whether a rejection came from a guard or from inside a procedure. That
  is the intended property: to the caller, `FORBIDDEN` is `FORBIDDEN`.
