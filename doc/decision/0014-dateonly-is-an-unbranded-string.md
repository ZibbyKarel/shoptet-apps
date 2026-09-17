# 0014 – `DateOnly` is an unbranded `string`

**Date:** 2026-08-28 · **Status:** accepted

## What

`DateOnly` in `libs/garage/shared-types` is a plain alias:

```ts
export type DateOnly = string;
```

It is not a branded type (`string & { __brand: 'DateOnly' }`). Runtime
guarantees come from `isDateOnly()` / `assertDateOnly()` in `libs/garage/shared-types`
and from `dateOnlySchema` (`z.iso.date()`) at the contract boundary — not from
the type system.

## Why

A brand would have to exist twice, and differently in each place:

- `libs/garage/shared-types` must not depend on Zod (see `doc/decision/0003-*`), so it
  would have to define its own brand;
- `libs/garage/contract` derives types exclusively via `z.infer`, so its `DateOnly`
  would be `z.infer<typeof dateOnlySchema>` — either a plain `string`, or Zod's
  own brand (`.brand<'DateOnly'>()`), which is structurally **different** from
  the hand-rolled one.

Whichever was chosen, the contract type and the domain type would not be
assignable to each other, and the service layer would be full of casts. A cast
on every line is worse than no brand at all: it also masks the errors a brand
would have caught.

Moreover, no value in the system is "a string that might or might not be a
date" — dates come from the DB (a `DATE` column) and from the contract
(`z.iso.date()`), both already validated.

## How

- `libs/garage/shared-types`'s public API validates every input value
  (`parseDateOnly()` calls `assertDateOnly()`), so an invalid string fails with
  a `TypeError` immediately, not three layers further down.
- `dateOnlySchema` in the contract also validates **calendar validity** —
  `z.iso.date()` rejects `2023-02-29` and `2026-04-31`, not just a bad format.
- `YearMonth` (`YYYY-MM`) is handled the same way.

## Risk if this is wrong

The type system won't stop an arbitrary `string` from being passed into a date
function. In practice it's caught either by `assertDateOnly()` at runtime, or
by a test. If this turns out to hurt, a brand can be introduced later in one
place (a type in `shared-types` + a `.transform()` in `dateOnlySchema`) — the
functions' API doesn't change.
