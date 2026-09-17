# 0082 — The feed's Czech copy lives in `libs/garage/calendar-export`, not in `libs/shared/i18n`

## What

The three user-facing strings in the ICS feed — the calendar's name
(`Parkování`), each event's summary (`Parkování – E2.92`) and its description
(`Rezervované parkovací místo E2.92.`) — are exported constants and functions in
`libs/garage/calendar-export/src/lib/reservation-calendar.ts`, not entries in the
`libs/shared/i18n` message catalog.

They stay **Czech**, like the rest of the UI (`doc/decision/0029-*`).

## Why

`libs/shared/i18n` is tagged `scope:web`. `libs/garage/calendar-export` and `apps/garage/api` are
`scope:api`, and `@nx/enforce-module-boundaries` refuses the dependency:

```
A project tagged with "scope:api" can only depend on libs tagged with
"scope:api", "scope:shared"   @nx/enforce-module-boundaries
```

(That is the literal output of a probe, not a reading of the config.) The rule is
right: `libs/shared/i18n` wraps `next-intl`, which is a React/Next package with no place
in a Nest process, and `doc/decision/0003-*` put that boundary there on purpose.

So there were three options:

1. **Move the catalog to `scope:shared`.** That drags `next-intl` — and its
   React peer — into the backend's dependency graph to render three strings.
   Rejected.
2. **Add a second, backend-only catalog.** `doc/i18n.md` is explicit that there
   is one catalog and never a second one; two catalogs is how a product ends up
   saying "Parkování" in one place and "Parkovací místo" in another.
3. **Keep the strings where the only backend consumer is.** Chosen.

This is not a general licence to scatter Czech copy through `apps/garage/api`. It
applies because the ICS feed is the **only** backend-rendered surface a user ever
reads — every other response is JSON that `apps/garage/web` turns into words. If a
second one appears (Slack notifications, Task 16), that is the moment to
reconsider option 2 with two real call sites in view rather than one.

## Why the parking group is not in the copy

`ParkingGroup` is `IT | SHARED`, and neither has a Czech label anywhere in the
workspace. Inventing one here would create a user-facing string that no designer
or product owner has seen, in the one place nobody looks. The event therefore
carries the spot's **label** — which is painted on the asphalt, so it needs no
translation — as `SUMMARY`, `LOCATION` and `DESCRIPTION`, and nothing else. The
contract's `icsCalendarEntrySchema` has no group field for the same reason.

## How

- `libs/garage/calendar-export/src/lib/reservation-calendar.ts` — `ICS_CALENDAR_NAME`,
  `icsEventSummary`, `icsEventDescription`.
- `libs/garage/calendar-export/src/lib/reservation-calendar.spec.ts` — asserts the
  Czech strings by reading them back through `ical.js`, including that the
  diacritics survive line folding.
- `apps/garage/api/src/calendar/calendar-pipeline.spec.ts` — asserts they survive the
  HTTP round trip as UTF-8.
