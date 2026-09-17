# 0140 – The day bar is its own file

## What

`DayBar` — the fixed date-navigation bar at the bottom of the lot screen
(Task 25) — moved out of `apps/garage/web/src/lot/lot-header/lot-header.tsx` into its own
`apps/garage/web/src/lot/date-nav-bar.tsx`, with its own `date-nav-bar.spec.tsx`.
`lot-header.tsx` keeps `LotHeader`, `WindowBanner` and `RealtimeNotice`; its
module doc comment was updated to say so. `lot-screen.tsx`'s only change is
its import: `DayBar` now comes from `./date-nav-bar` instead of
`./lot-header`.

The component itself, its props (`DayBarProps`) and its rendering are
unchanged — this is a file move, not a rewrite. `MONTHS_IN_YEAR` moved with
it, since nothing else in `lot-header.tsx` used it.

## Why

Task 31 (the bulk-reservation modal) is being built at the same time, from
the same base commit, and also edits `lot-screen.tsx` and the files it
imports from. Before this change, `DayBar` lived in the same file as
`LotHeader` — the component Task 31's modal trigger sits directly beside —
so any edit to `lot-header.tsx` by either task risked colliding on the same
lines even though the two pieces of work touch unrelated parts of the screen.

Splitting `DayBar` into its own file removes that shared surface entirely:
Task 25 can add, test and document the day bar without a single line of
`lot-header.tsx` changing, and `lot-screen.tsx`'s own diff is two import
lines rather than a restructuring. `LotHeader`, `WindowBanner` and
`RealtimeNotice` were left in place — they are Task 24's, not Task 25's, and
moving them would have widened this task's footprint for no reason connected
to the day bar.

A second reason, independent of Task 31: before this change `DayBar` had **no
test at all**. `lot-header.tsx`'s three other exports are exercised
indirectly through `lot-screen.spec.tsx` (which renders the whole screen),
but nothing in the repository rendered `DayBar` in isolation — its prev/next
buttons, its month/year selects reporting parsed numbers rather than raw
`ChangeEvent`s, and the holiday/weekend highlight from `note.highlighted`
were all unverified. Giving it its own file made it natural to give it its
own focused spec (`date-nav-bar.spec.tsx`) instead of folding untested
assertions into `lot-screen.spec.tsx`'s already-large suite.

## Consequences

- `lot-header.tsx` no longer imports `Select` or `formatMonthName` — only
  `DayBar` used them.
- Any future screen that needs the same sticky day picker imports
  `./date-nav-bar` directly; `lot-header.tsx` is no longer a place to look for
  it.
- `date-nav-bar.spec.tsx` doubles nothing beyond the wrapper boundary
  (`IntlProvider`, real) — `DayBar` takes a pre-computed `DayNoteView` rather
  than deciding holiday/weekend itself, so the suite needs no clock, no
  holiday calendar and no query client.

## Verified by

`date-nav-bar.spec.tsx` (11 tests): the date renders through the same
formatter as the page heading, every month and exactly the given years are
offered, all five controls report parsed values through their callbacks, and
the bar reads yellow with the holiday name on a public holiday, yellow with
no name on a weekend, and neutral with "Pracovní den" otherwise.

Mutation-tested during implementation (not left in the tree): inverting the
`note.highlighted` ternary failed all three highlight tests; passing the
month select's raw string through `onMonth` instead of `Number(...)` failed
"reports the chosen month as a number"; dropping the previous-day button's
`onClick` failed "calls onPreviousDay from the left arrow". All three
mutations were reverted after confirming the failure.
