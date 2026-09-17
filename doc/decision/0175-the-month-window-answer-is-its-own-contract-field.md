# 0175 – The month-window answer is its own contract field, because `canReserve` is per-day

**Date:** 2026-09-03 · **Status:** accepted · **Affects:** `libs/garage/contract/src/api/overview.ts`,
`apps/garage/api/src/overview/day-overview.service.ts`, `apps/garage/web/src/lot/*`
**Follows on from:** `doc/decision/0120-*`, `doc/decision/0064-*`

## What

`overview.day` gains a second boolean, **`canReserveMonth`**: whether this caller may create
reservations *anywhere in the month* `date` falls in.

`DayOverviewService` is refactored into the two halves that were already inside its one
`canReserve` method, and `canReserve` becomes their conjunction:

```
canReserveMonth = role === 'ADMIN' || isMonthOpen(date, openDaysBefore, lockMode, today)
isReservableDay = date >= today && isBusinessDay(date)

canReserve      = canReserveMonth && isReservableDay
```

That composition is behaviour-identical to the four sequential rules it replaces — the admin
exemption still does not rescue a weekend, because `isReservableDay` is evaluated regardless of
role. The seven pre-existing `canReserve` tests pass unchanged, which is the evidence.

The bulk modal and its entry point read `canReserveMonth`. `canReserve` keeps every other consumer:
the spot tiles, the spot dialog and the cell locks are all about one day.

## Why

**`canReserve` was being used as a per-month answer and it is not one.** Its first two rules — a
past day, and a weekend or Czech public holiday — are facts about the *anchor day*, and the bulk
modal's anchor day is simply whichever day the lot screen happens to be showing. So the feature
switched itself off for a reason that has nothing to do with bulk reservation.

Sizing the damage needs one more fact about the window, which the first draft of this record got
wrong: **the window closes at the start of the target month** (`reservation-window.ts`, from
`doc/decision/0004-*`), so a month that is open is always a *future* month. That does not rescue
the old gate, it narrows which days it broke:

| caller | days of an open month where the old gate hid bulk |
| --- | --- |
| ordinary user | every Saturday, every Sunday, every Czech public holiday of that future month |
| admin (no window at all) | the same, plus every past day |

Weekends and holidays are close to a third of any month, and they are exactly the days somebody
sits down to plan the next month *from*. A user browsing to a Saturday in October to lay out their
October found no "Hromadná rezervace" button.

**The design says so directly.** `doc/design/screens/10-modal-bulk.png` shows the modal **open** on
`pondělí 28. září 2026`, which the same screenshot's footer labels
`STÁTNÍ SVÁTEK · DEN ČESKÉ STÁTNOSTI` — the exact holiday `bulk-modal.spec.tsx` asserts is
unselectable *inside* the grid. Both facts are correct at once, and only a per-month gate can
express them: the day cannot be booked, the month can.

**Why not derive it on the client from `window.state`.** Because `doc/decision/0120-*` is right and
still applies. `window.state` is per-month, but it is the *window's* state, not this caller's
permission: an admin is not bound by the window at all and that exemption appears nowhere in the
payload. `window.state === 'LOCKED' && canReserveMonth === true` is a normal, correct response for
an admin. A client that inferred the month state from `window` would be re-deriving authorisation
from data that cannot express it — the same mistake in a new place.

**Why not infer it from `canReserve` plus the day's own business-day check.** The client *could*
compute `canReserve || !isBusinessDay(date) || date < today` and be right today. That is a
re-derivation of a backend rule from its own output, it silently depends on the exact rule order
inside `DayOverviewService`, and it would break the moment a fifth rule is added. Contract-first
means the backend answers the question the screen actually asks.

**Why one field rather than exposing the two halves separately.** `isReservableDay` is a pure
function of the date and the Czech calendar — `isBusinessDay` and a comparison — and the client
already has both through `@garage/i18n`. There is no information in it the client lacks.
`canReserveMonth` is the half that depends on server state (the window settings) and on identity
(the role), so it is the half that has to travel.

## How

- `libs/garage/contract/src/api/overview.ts` — the field, documented as "the window and the admin
  exemption, and nothing about `date` itself". `overview.spec.ts` asserts it is required, and
  asserts that `canReserve: false` beside `canReserveMonth: true` is a **valid** payload — that
  combination is every weekend of every open month, not a contradiction.
- `apps/garage/api/src/overview/day-overview.service.ts` — `canReserveMonth` and `isReservableDay` as two
  private methods, with `canReserve` composed from them at the one call site.
  `day-overview.service.spec.ts` gains a `canReserveMonth` block: the two fields disagreeing on a
  Saturday of an open October, on 28 September seen from inside September's window, and on a past
  day for an admin; agreeing at `false` in a not-yet-open and in a locked month; the admin
  exemption in a locked month; and the ordering case that proves the exemption does not rescue a
  Saturday. The three disagreement tests assert `window.state === 'OPEN'` rather than assuming it,
  because a fixture whose month was quietly locked would pass every one of them.
- `apps/garage/web/src/lot/lot-screen/lot-screen.tsx` — both `showBulk` and the modal's prop.
- `apps/garage/web/src/lot/bulk-modal/bulk-modal.tsx` — the prop is renamed `canReserveMonth`, so the wrong field
  cannot be passed without a type error.

## Risk

**Two booleans that look alike.** `canReserve` and `canReserveMonth` differ by two rules and a
careless reader will reach for the first. Mitigated by naming (the prop carries the field's name,
so a mix-up is a compile error), by the contract comment, and by
`lot-screen.spec.tsx` › *"keeps the button on a weekend or holiday of an open month, where
canReserve is false"*, which fails if the wrong one is wired.

**The bulk grid may now be opened on a day the caller cannot book.** That is the point, and it is
harmless: the grid's own cells are still blocked per day by `buildMonthGrid`, and the backend still
refuses a batch containing a past or non-business day.

**A change to the day rules must keep the composition honest.** If a future rule is neither
per-day nor per-month — say, a per-user quota — it belongs in neither half and both fields would
need re-deriving. The composition is written on one line at the call site so that this is visible.
