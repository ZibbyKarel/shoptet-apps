# 0168 – The admin tables do not show who is editing a spot

## What

`04-admin-spots.png` draws three values in the **STAV DNES** column:

- `Obsazeno — Karel Zíbar`
- `Volné`
- `Upravuje Jana Dvořáková`

`06-admin-overview.png` paints the same third state as a hatched tile reading
*"právě upravuje Jana Dvořáková"*.

The shipped column implements the first two, plus `—` for a spot the day
overview does not carry. The third is **not** implemented.

## Why

- **The contract has no field for it.** `daySpotOverviewSchema`
  (`libs/garage/contract/src/api/overview.ts`) carries `spot`, `reservation` and
  `waitlistCount`. Nothing in `admin.spot.list` or `overview.day` says who has a
  spot open in front of them.
- **That is not an oversight in the contract.** "Somebody is editing this right
  now" is presence, not state: it is true for seconds, it belongs to no
  database row, and it is delivered over the Socket.io channel
  (`@garage/contract/realtime`), which is where the lot screen's cell locks
  already live. Adding it to a REST-shaped read would make it a cached value
  that goes stale silently — the worst possible representation of a fact whose
  only virtue is being current.
- **The administration section does not subscribe to realtime at all.** Wiring a
  subscription into a tab so one column can render a transient label is a larger
  change than the column is worth, and it is Task 25's/the lot screen's
  territory, where the same signal is already drawn.
- **`—` is honest about the same thing.** The column says what the day overview
  reports. Where it reports nothing, the column claims nothing.

Recorded because the two other divergences on this tab have records (`0161`,
`0164`) and this one did not — an undocumented absence reads as an oversight,
which is exactly what a reviewer flagged.

## How

- `admin-spots-screen.tsx` renders `holderName` when the day overview has a row
  for the spot, `Volné` when it has one with no reservation, and
  `spotsTodayUnknown` (`—`) when it has none.
- Nothing subscribes to `@garage/contract/realtime` from `shell/admin/`.

## Risk

- **The stated failure is real.** An admin can look at `Stav dnes`, see `Volné`
  for a spot a colleague has open, and retire it out from under them —
  `SpotsService.requireNoFutureReservations` checks reservations, not edit
  locks, so the API accepts it.

  The cost is bounded: the colleague's next write fails against the retired
  spot and says so, the spot is retired rather than deleted, and reviving it is
  one switch. Nothing is lost but the edit in progress.

- **The whole tab is a point-in-time read.** No admin tab refetches on realtime
  events, so a reservation made in another tab is invisible until something
  refetches. Whether that matters is a product question; if the answer is yes,
  it should be answered for all four tabs at once and not by special-casing one
  column.
