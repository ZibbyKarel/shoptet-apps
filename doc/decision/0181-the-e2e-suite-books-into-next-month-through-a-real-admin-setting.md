# 0181 – The e2e suite books into next month, through a real admin setting

## What

Before the browsers start, `libs/garage/database/src/scripts/reset-e2e.ts` sets the
reservation window to `openDaysBefore: 31, lockMode: 'AUTO'` and clears every
reservation and queue entry in the **next** calendar month. Every scenario that
writes then books a business day of that month, chosen by
`e2eBusinessDays()` rather than written as a literal.

The lock mode stays `AUTO`. `FORCE_OPEN` — which would also have made the month
bookable — is deliberately not used.

## Why

**No month is bookable on most days of the year at the seeded settings.**
`monthLockState` locks a month from its own first day onwards, and opens it
`openDaysBefore` days before that:

| today | month | state at `openDaysBefore = 7` |
| --- | --- | --- |
| 3 Sep | September | `LOCKED` (the current month always is) |
| 3 Sep | October | `NOT_YET_OPEN` (opens 24 Sep) |

So on 3 September a normal user can create no reservation at all, join no
queue, and the suite's five write scenarios have nothing to exercise. That is
not a defect — it is the product rule — but it makes the seeded value unusable
as a test fixture.

At `openDaysBefore = 31` (`MAX_OPEN_DAYS_BEFORE`, the largest value the admin
form accepts) the next month is open on **every** day of the year: its window
opens `31` days before the 1st, which is on or before the 1st of the current
month, and closes on the current month's last day. That is a property of the
rule, not a coincidence of today's date, so the suite is not seasonal.

**Why not `FORCE_OPEN`.** It would be one field instead of one number, and it
would be wrong: `FORCE_OPEN` opens *every* month including ones in the past, so
the suite would stop being able to tell "the window is open" from "the window is
overridden", and `reservation.spec.ts`'s opening assertion — that the bay is
genuinely free and reservable — would pass under a setting no deployment would
ever run. `AUTO` at 31 days is a configuration a real office could have.

**Why not an admin exemption.** An admin ignores the month window entirely
(`DayOverviewService.canReserveMonth`). Running the whole suite as the admin
would make every write scenario pass regardless of the window, which is the
"passes on a defence other than the one it names" failure in its purest form.
The ordinary personas do the ordinary work; the admin only does admin work.

**Why a database fixture rather than the admin UI.** Driving `/admin` →
*Rezervační okno* before every run would put a second, slower, flakier
dependency in front of every other scenario, and the admin window screen has its
own unit coverage. Writing the row directly is data setup, not an application
back door: it changes a value an admin can change, through no code path the
application does not already have.

## How

- `libs/garage/database/src/scripts/reset-e2e.ts` — deletes the month's reservations
  and queue entries, upserts the window settings, refuses to run with
  `NODE_ENV=production`.
- `libs/garage/database/project.json` — `nx run database:reset-e2e` for running it by
  hand.
- `apps/garage/web-e2e/src/support/global-setup.ts` — runs `prisma db seed` and then
  the reset script, as subprocesses (see `0184`).
- `apps/garage/web-e2e/src/support/dates.ts` — `e2eBusinessDays()` and the
  `SPEC_DAY_SLOTS` table that gives each spec file its own day.
- `reservation.spec.ts` asserts the bay is free and reservable *before* booking
  it, so a window that silently failed to open would fail there rather than
  producing a mysterious error later.

## Risk

- **It changes a global setting on the developer's own database.** A developer
  who ran the suite and then went back to clicking around will find the window
  at 31 days rather than 7. `prisma db seed` puts it back, and `doc/testing.md`
  says so.
- **It deletes a month of reservations.** Scoped to the target month rather than
  truncating the tables, and guarded against `NODE_ENV=production`, but it is
  still a destructive script pointed at whatever `DATABASE_URL` says. It is a
  development tool and is documented as one.
- **The suite cannot see a `NOT_YET_OPEN` or `LOCKED` month.** Those states are
  covered by unit tests over `monthLockState` and by the window banner's own
  component tests; nothing end-to-end exercises them. Adding a spec that flips
  the setting mid-run would make every other spec's month state timing-dependent,
  which is a worse trade.
