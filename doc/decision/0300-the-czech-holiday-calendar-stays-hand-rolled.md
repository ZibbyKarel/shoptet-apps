# 0300 – The Czech holiday calendar stays hand-rolled

**Date:** 2026-09-07 · **Status:** accepted · **Task:** TODO item 2 · **Follows on from:**
`doc/decision/0003-*`, `doc/decision/0004-*`

## What

`libs/garage/shared-types/src/lib/czech-holidays.ts` computes the thirteen Czech public holidays
itself — eleven fixed dates plus Good Friday and Easter Monday from a Meeus/Jones/Butcher
Easter algorithm. No npm package replaces it, and none will be adopted without this record
being revisited.

## Why

The npm registry was searched on 2026-09-07 for a library that does this. Exactly two
candidates exist.

The table below is a snapshot **as of 2026-09-07** — read "Last published" against that date,
not against whatever date you are reading this.

| Package          | Latest | Last published | Types | License           | Unpacked | Deps                                                  |
| ---------------- | ------ | -------------- | ----- | ----------------- | -------- | ----------------------------------------------------- |
| `czech-holidays` | 1.0.6  | 2022-04-28     | none  | GPL-3.0-or-later  | 39 KB    | —                                                     |
| `date-holidays`  | 3.36.1 | 2026-09-06     | yes   | ISC AND CC-BY-3.0 | 11.0 MB  | `lodash`, `js-yaml`, `prepin`, `date-holidays-parser` |

`holiday-cz`, `cz-holidays` and `@nager/date` do not exist on the registry (404). There is no
third option.

**`czech-holidays` fails on license and on maintenance.** GPL-3.0-or-later is copyleft, and
taking it into a company product is a legal decision nobody in this ticket has the standing to
make. Separately, it was last published in 2022 and ships no TypeScript types, so it would
need a hand-written declaration file — the same maintenance, moved somewhere less visible.

**`date-holidays` fails on weight, in the one place weight is not negotiable.** It is well
maintained and it is the right library for an app that needs holidays in arbitrary countries.
This app needs thirteen dates a year in one country. `libs/garage/shared-types`' barrel is re-exported
wholesale as `@garage/i18n` (`doc/decision/0003-*`) and `apps/garage/web/src/lot/lot-view.ts` calls
`czechPublicHolidayOn`, so **everything this lib publishes reaches the browser bundle**.
Adopting it would put `lodash` and a YAML parser in front of the user to replace sixty lines of
integer arithmetic. Its CC-BY-3.0 holiday data would also oblige an attribution the product
does not currently carry.

Both also fail a third test, which is the one worth remembering: neither returns what this
module's callers consume. `czechPublicHolidayOn` returns a stable `id` **and** the official
Czech `name`, and `GOOD_FRIDAY_FIRST_YEAR` encodes that Good Friday only became a public
holiday with the 2016 amendment of act 245/2000 Sb. A library handing back localized strings
keyed on nothing stable would have to be adapted into that shape — which is most of the file
again, as a wrapper over 11 MB.

## What changed instead

The item's second half — "the whole file is unsatisfying" — was taken at face value, and three
things were fixed:

- The fixed-date table was a positional tuple (`[7, 5, 'CYRIL_AND_METHODIUS', …]` next to
  `[7, 6, 'JAN_HUS', …]`), where a month/day transposition was invisible to the type system.
  It is now a named-field table.
- `czechPublicHolidays(year)` rebuilt and re-sorted the year on every call. The real per-day
  callers are `buildMonthGrid` in `apps/garage/web/src/lot/bulk-modal/bulk-view.ts` (28–31 days per
  rendered month), `planDay` in `apps/garage/api/src/reservations/bulk-allocator.ts` (once per date in
  a bulk request), and `isReservableDay` in `apps/garage/api/src/overview/day-overview.service.ts` — so
  walking a month's worth of days re-ran the Easter algorithm thirty-odd times, server-side as
  well as in the browser. (`apps/garage/web/src/lot/lot-view.ts`'s `toDayNoteView` is called once per
  rendered day _screen_, not once per day of a month, so it was not the driver.) The list is now
  memoized per year in a module-level `Map`, and both it and its entries are frozen before it
  escapes. It is a pure function of the year, so there is nothing to invalidate.
- The `CzechHoliday` doc comment now says outright that `id` is the key and `name` is a Czech
  default label, so localizing holiday names is the message catalog's job.

The public API did not change. `czechPublicHolidayOn`, `isCzechPublicHoliday`, `isBusinessDay`
and the `CzechHoliday` type keep their names, signatures and semantics.

## Consequences

- Eleven statutory dates are maintained by hand. They have not changed since 2016 and a change
  would be an act of parliament, which is the kind of event a `git blame` line is adequate for.
- The Easter algorithm is ours to be wrong about. `czech-holidays.spec.ts` pins Easter Sunday
  against thirteen independently published dates from 2008 to 2038, including the near-term
  earliest (2008-03-23) and latest (2038-04-25), and asserts Easter always lands on a Sunday
  for 2020–2050.
- `czechPublicHolidays` returns a shared array rather than a fresh one, which changes what a
  mutating caller costs: before, it corrupted only its own copy; now it would rewrite what
  every later caller reads. That is why the array **and each entry in it** are frozen —
  `Object.freeze` is shallow, so sealing only the array would leave `holidays[0].name`
  writable and make the situation strictly worse than before the cache. The nested freeze is
  load-bearing, not decoration, and `czech-holidays.spec.ts` fails if the inner one is
  removed. `czechPublicHolidays` itself is not exported from the lib's barrel
  (`libs/garage/shared-types/src/index.ts`), so no consumer outside `libs/garage/shared-types` is affected
  either way — but `czechPublicHolidayOn` **is** barrel-exported, and it now returns an element
  of that same shared, frozen array rather than a fresh object. A future caller that writes to a
  field of the holiday it gets back sees a silent no-op or a `TypeError`, depending on strict
  mode. No current caller does this.
- `holidaysByYear` grows without bound: nothing ever evicts an entry. The year comes from a
  validated `DateOnly` whose pattern allows any four digits, so the ceiling is on the order of
  10,000 entries × 13 frozen objects — a few MB — and only reachable by walking that many
  distinct years through a request-influenced path in a long-lived API process. It is bounded
  and does not need a code change, just this note so nobody has to re-derive it.
- This record's rejection of `date-holidays` rests on this lib's barrel being re-exported
  wholesale as `@garage/i18n` (`doc/decision/0003-*`), which puts everything it publishes in
  the browser bundle. Adding a second country would not change that fact, so this record is
  **not** a green light for adopting `date-holidays` later — a second country still means an
  11 MB dependency reaching the browser unless the consumer changes shape. The one case where
  the calculus could differ is a holiday lookup that stays entirely server-side and never
  reaches `apps/garage/web` (so it could live outside this barrel, or behind a lib that is not
  re-exported as `@garage/i18n`) — anyone reaching for `date-holidays` should confirm that
  condition first, not treat "a second country" alone as sufficient.

## Alternatives considered

- **Adopt `czech-holidays` and write the type declarations.** Rejected: the license question
  outranks the convenience, and it is unmaintained.
- **Adopt `date-holidays` and tree-shake it.** Rejected: the data is loaded from YAML at
  runtime by `date-holidays-parser`, so the country data is not statically eliminable — the
  parser and `js-yaml` ship whether or not eleven of its countries are used.
- **Keep the file exactly as it was.** Rejected: the transposition hazard and the per-day
  re-sort are real, and "is there a library?" deserved a measured answer rather than a fourth
  asking.
