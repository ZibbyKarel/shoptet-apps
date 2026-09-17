# 0013 – Date arithmetic is calendar-based; the timezone is resolved at a single boundary

**Date:** 2026-08-28 · **Status:** accepted · **Follows on from:** `doc/decision/0003-date-helpers-in-shared-types.md`

## What

`libs/garage/shared-types` is split into two layers with a sharp boundary:

- **`date-only.ts` – purely calendar-based.** Shifting days, day differences,
  comparisons, start/end of month, day of week. It knows nothing about any
  timezone. Internally it computes via an "epoch day" in UTC
  (`Date.prototype.setUTCFullYear` + `getTime() / 86,400,000`).
- **`prague-time.ts` – the single place that knows about `Europe/Prague`.**
  Converts between an instant (`Date`) and a calendar day: `todayInPrague()`,
  `toDateOnlyInPrague()`, `startOfDayInPrague()`, `endOfDayExclusiveInPrague()`.
  Zone rules are delegated to ICU via `Intl.DateTimeFormat` with an explicit
  `timeZone`, never to the process's local time.

`todayInPrague(now?)` takes the instant as an optional parameter, so domain logic
and tests never need to touch the clock.

## Why

A reservation day is a **calendar day**, not an instant. As soon as it's treated as
a timestamp, two cases break:

1. **The daylight-saving transition.** `2026-03-29` has 23 hours in Prague, and
   `2026-10-25` has 25 hours. An implementation that "adds a day" as `+86,400,000
   ms` to local time will skip or repeat a day on those two days of the year. UTC
   has no daylight saving, so arithmetic over the epoch day is exact always.
2. **The machine's zone.** `new Date()` read as local time gives a different day
   on a server in UTC than on a laptop in Prague — between 22:00/23:00 UTC and
   midnight, it's already tomorrow in Prague. `Intl` with an explicit zone gives
   the same answer everywhere.

`Intl.DateTimeFormat` was chosen deliberately over a hand-rolled offset table: ICU
maintains the daylight-saving rules at runtime, we don't.

## How

- `startOfDayInPrague()` derives the instant of local midnight via a two-pass
  offset correction (the offset in the estimate and the offset at the corrected
  instant differ across a daylight-saving transition).
- Tests pin **instants** (`2026-08-27T22:30:00Z`), never local clock values, and
  the critical cases are repeated under several `process.env.TZ` settings
  (`UTC`, `Europe/Prague`, `America/Los_Angeles`, `Pacific/Kiritimati`). An
  implementation that reads the machine's local time passes in one zone and fails
  in the others.
- Covered edge cases: both sides of both 2026 daylight-saving transitions, the
  year boundary (which happens an hour earlier in Prague than in UTC), a leap
  year.

## Risk if this is wrong

A bug in this layer is silent and shows up only twice a year (a reservation off
by one day) or only between 22:00 and midnight. That's why the tests are built on
instants and on switching the process's zone — a naive implementation won't pass
them. If more turns out to be needed (e.g. working with time intervals), the
boundary is such that a function is added to `prague-time.ts` and `date-only.ts`
stays untouched.
