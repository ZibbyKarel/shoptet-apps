# 0174 – The Czech locative month name is a hand-written table, because `Intl` has no third form

**Date:** 2026-09-03 · **Status:** accepted · **Affects:** `libs/shared/i18n/src/lib/dates.ts`
**Follows on from:** `doc/decision/0003-*`

## What

`libs/shared/i18n` gains two date helpers:

- `formatWeekdayName(date)` → `čtvrtek`, asked of `Intl` like every other formatter here;
- `formatMonthLocative(month)` → `září`, `srpnu`, `prosinci` — from a **hand-written twelve-entry
  table**, the only such table in the module.

`formatMonthLocative` throws a `RangeError` outside 1–12 rather than returning `undefined`.

## Why

**The bulk modal's own description needs the locative and nothing else will do.**
`doc/design/screens/10-modal-bulk.png` reads *"Vyberte dny v září."* — a month after the preposition
`v`, which in Czech takes the locative case.

**`Intl` genuinely cannot produce it.** CLDR carries two Czech month forms and this module already
depends on the distinction: the `format` form (genitive — `25. srpna`, produced whenever `day` is
part of the same call) and the `stand-alone` form (nominative — `srpen`, produced when it is not).
That is what `dates.ts`'s module comment is about, and why the two option objects must not be
merged. There is no third form and no option that asks for one: the locative (`srpnu`) is simply not
in the data. This is the opposite situation to the genitive, where a hand-picked table would have
been duplicating locale data that already exists — here there is nothing to duplicate.

**The alternative was to reword around the case,** e.g. "Vyberte dny v měsíci září", which is
grammatical because `v měsíci` takes the nominative. It is also not what the design says, and the
design wins where it conflicts with prose.

**Why in `libs/shared/i18n` rather than in the modal.** A fact about the Czech language belongs in the lib
that owns Czech language facts, next to the formatters it sits between. Putting twelve month names
in `apps/garage/web` would also have put UI-adjacent locale data outside the one place `doc/i18n.md` points
readers at.

## How

- `libs/shared/i18n/src/lib/dates.ts` — `CZECH_MONTHS_LOCATIVE` and `formatMonthLocative`, with the
  reasoning above at the definition so nobody "simplifies" it into `formatMonthName`.
- `dates.spec.ts` pins all twelve, and separately asserts that the locative **differs from the
  nominative for every month except září**. That second test is the one that matters: září is the
  one month whose four cases coincide, so a table accidentally copied from `formatMonthName` would
  pass a design-derived check and fail this one.
- `formatWeekdayName` is pinned across a full Monday-to-Sunday week and on a date whose weekday
  would change if the formatter built a local midnight instead of a UTC one.

## Risk

**Twelve strings that no test can derive from anywhere else.** They were written once and checked
against a Czech grammar reference; nothing in the toolchain can catch a typo in
`červenci` beyond the spec that spells it out. The mitigation is that the list is closed, short,
and only ever grows if the calendar does.

**It is a precedent.** A future sentence needing the accusative or the instrumental will want a
second table. If that happens, the tables should move together into one `CZECH_MONTHS` record keyed
by case rather than accumulating as loose arrays.

> **Note (0303):** `CZECH_MONTHS_LOCATIVE` and `formatMonthLocative` in `dates.ts` were renamed to the exported table `MONTH_LOCATIVE_CS` and the method `monthLocative` on `createDateFormatters(locale)` by `doc/decision/0303-*`. The reasoning above is unaffected.
