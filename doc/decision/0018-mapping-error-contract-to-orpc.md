# 0018 – The error contract maps onto oRPC 1:1, `details` = `data`

**Date:** 2026-08-28 · **Status:** accepted · **Follows on from:** Task 3 (`errorShapeSchema`)

## What

Task 3 introduced a uniform error shape, `{ code, message, details? }`, and a
closed enum of twelve `ERROR_CODES`. oRPC has its own typed-error mechanism,
where an error is declared as `.errors({ CODE: { status, message, data } })`
and has the wire shape `{ code, message, data }`.

Decision: **no extra layer is introduced.** Our enum is directly the key of
oRPC's error map; `errorShapeSchema.details` and oRPC's `data` are **the same
field under two names**.

Specifically:

- `libs/garage/contract/src/api/errors.ts` holds `ERROR_DEFINITIONS` — one definition
  per code, with an HTTP status and a default (developer-facing, English)
  message. `satisfies Record<ErrorCode, …>` guards against the two lists
  drifting apart; a test also verifies it at runtime.
- `contractErrors('NOT_FOUND', 'CONFLICT')` is a typed `Pick` — a procedure only
  declares the codes it can actually return, and the client never sees the
  others.
- `FORBIDDEN` is declared **once**, on the shared `authed` builder, because
  it's reachable literally everywhere: a deactivated user (`active: false`,
  which is how offboarding works) is rejected before any handler runs.

Status mapping:

| code | status | | code | status |
| --- | --- | --- | --- | --- |
| `SPOT_ALREADY_RESERVED` | 409 | | `ALREADY_IN_WAITLIST` | 409 |
| `RESERVATION_LIMIT_REACHED` | 409 | | `CANNOT_WAITLIST_OWN_SPOT` | 422 |
| `PAST_DATE` | 422 | | `SPOT_NOT_OCCUPIED` | 409 |
| `OUT_OF_HORIZON` | 422 | | `VALIDATION_FAILED` | 400 |
| `NOT_FOUND` | 404 | | `CONFLICT` | 409 |
| `FORBIDDEN` | 403 | | `RESERVATIONS_LOCKED` | **423** |

## Why

**Why not rename `details` to `data`.** `errorShapeSchema` went through the
Task 3 review, and the error documentation in `doc/contract.md` uses it too.
Renaming would be churn with no benefit: the field is the same, only the name
differs depending on which side you're looking from. The frontend never reads
it through `errorShapeSchema` — it reads the typed error off the oRPC client,
where it's called `data`.

**Why no custom envelope.** The alternative was to return `errorShapeSchema` as
a *successful* result (the `{ ok: false, error }` style). That would throw away
the entire point of oRPC's typed errors: the client would have to branch
manually, TypeScript wouldn't verify that a procedure returns only its
declared codes, and the HTTP status would always be 200. Contract-first means
using the mechanism the contract already offers.

**Why 423 for `RESERVATIONS_LOCKED`.** Both "window" codes must be
distinguishable at a glance, even in a log or a proxy where nobody reads
`code`. `OUT_OF_HORIZON` (the month isn't open yet) is 422 — the request makes
sense, just not now. `RESERVATIONS_LOCKED` is 423 Locked, which is exactly the
semantics of a closed window.

**Why `data` is optional.** Most errors need nothing extra; the few that do
(the id of the colliding reservation, which month is locked) send it. Making
`data` mandatory would force sending `{}` everywhere.

## How

```ts
export const createReservationContract = authed          // declares FORBIDDEN
  .input(createReservationInputSchema)
  .output(createReservationOutputSchema)
  .errors(contractErrors('NOT_FOUND', 'SPOT_ALREADY_RESERVED', /* … */));
```

The backend (Task 12/13) throws the error via
`errors.SPOT_ALREADY_RESERVED({ data: { … } })`. The global exception filter in
`apps/garage/api` is the last safeguard for anything untyped.

A new code is added in **three steps, in this order**: `ERROR_CODES` (the Task
3 file) → `ERROR_DEFINITIONS` (status + message) → `contractErrors(...)` on
the specific procedures. `errors.spec.ts` fails if the second step is skipped,
`router.spec.ts` if the third is.

`noInputSchema` — the schema for argument-less procedures — lives in the same
file. It isn't an error, but it belongs with `authed`: it's the second thing
**every** procedure builds on, and splitting two shared building blocks across
two files would mean one of them gets forgotten. Why `.input()` isn't skipped,
and why the schema accepts both `undefined` and `{}`, is explained in a
comment next to it.

## Risk if this is wrong

A wrongly chosen status is cosmetic — the frontend branches on `code`, not on
the status. The real risk runs the other way: a procedure that declares a code
it never returns (noise in the client's types), or the reverse, one that
returns an undeclared code (it ends up as an "unknown error" and the UI shows
a generic message). That's why the list of codes per procedure is written out
explicitly in `router.spec.ts` — every change shows up in the diff.
