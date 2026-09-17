# @garage/shared-types

Domain constants and pure `Europe/Prague` date-only logic. Imported by
`apps/garage/api`, `libs/garage/contract` and `libs/shared/i18n` alike, so it stays **dependency
free** — no Zod, no next-intl, nothing from npm.

Contents:

- `date-only.ts` — the `DateOnly` (`YYYY-MM-DD`) primitive and civil calendar
  arithmetic. Knows nothing about time zones.
- `prague-time.ts` — the single place that maps between instants and calendar
  days in `Europe/Prague`.
- `czech-holidays.ts` — Czech public holidays, fixed and Easter-derived.
- `domain-constants.ts` — closed enumerations (`ParkingGroup`, `UserRole`,
  `ReservationLockMode`, `MonthLockState`) and the reservation-window defaults.
- `reservation-window.ts` — `isMonthOpen` / `monthLockState`, pure and
  parameterised; they report state and never enforce it.

Documentation: `doc/contract.md`, `doc/decision/0003-*`, `0004-*`, `0013-calendar-arithmetic-and-single-timezone-boundary`,
`0014-*`.

## Tests

```bash
npx nx run shared-types:test
```
