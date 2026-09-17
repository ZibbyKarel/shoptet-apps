# 0015 – Timestamps in the contract are ISO strings, not `Date`

**Date:** 2026-08-28 · **Status:** accepted

## What

`createdAt` / `updatedAt` and every other timestamp have the schema
`timestampSchema = z.iso.datetime()` in `libs/garage/contract`, i.e. a **string** in
UTC (`2026-08-28T09:15:00.000Z`). Neither `z.date()` nor `z.coerce.date()` is
used.

This does not apply to the reservation day — that one is `dateOnlySchema`
(`YYYY-MM-DD`) and `DATE` in Postgres, never a timestamp.

## Why

- **The contract stays transport-neutral.** The schema holds equally for the
  oRPC RPC protocol, for plain JSON, for OpenAPI, and for a Socket.io event
  payload. `z.date()` only works where there is a serializer on both sides that
  reconstructs `Date` — otherwise `JSON.stringify` turns it into a string and
  the schema on the other side fails.
- **Consistency with the date-only semantics.** The contract already has the
  convention "a date is a string"; having "time is an object" as a second
  convention alongside it would be redundant.
- **Fails loudly, not silently.** `z.coerce.date()` would accept almost
  anything and produce an `Invalid Date`; `z.iso.datetime()` rejects invalid
  input outright.

By default `z.iso.datetime()` accepts **only `Z`**, not offsets (`+02:00`).
That is deliberate: a single wire format, no guessing whether it's `+02:00` or
`+01:00`.

## How

- The backend serializes timestamps via `Date.prototype.toISOString()`.
- The frontend only builds a `Date` where it actually needs one (formatting in
  `libs/shared/i18n`).
- Prisma returns `Date`; mapping it to a string is mechanical and happens in
  the service layer that assembles the entity into the contract shape.

## Risk if this is wrong

If oRPC's `Date` serialization turns out to be convenient enough to be worth
losing transport neutrality, the change is local: `timestampSchema` is a single
place and types are derived, so one line gets rewritten and TypeScript points
at every call site. Task 4 (oRPC procedures) is the last moment where
reconsidering this is cheap.
