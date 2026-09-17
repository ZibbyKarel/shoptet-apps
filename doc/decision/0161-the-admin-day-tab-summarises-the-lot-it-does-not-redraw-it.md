# 0161 – The admin day tab summarises the lot; it does not redraw it

## What

The first tab of `/admin`, "Přehled parkoviště"
(`apps/garage/web/src/shell/admin/admin-day-screen/admin-day-screen.tsx`), renders the day's **date**,
the free/taken **counts**, the reservation-window **banner**, a `DataTable` with
one row per spot (label, category, who holds it, how many are queued), and a
button that opens the lot screen.

It does **not** render the painted car grid that
`doc/design/screens/06-admin-overview.png` shows.

## Why

- **`06-admin-overview.png` is the lot screen, not a tab.** It has no tab
  strip and no "Administrace / Správa" heading; it has the lot's own eyebrow,
  its date heading, and the bottom date bar. The three tabbed mocks
  (`03`, `04`, `05`) list "Přehled parkoviště" first in the strip, so the
  design's own intent is that the tab leads to *that* screen — which is the lot
  screen, and which for an admin looks like `06`.
- **The grid belongs to Task 24 and only there.** It is the product's most
  stateful surface: per-cell realtime locks, waitlist badges, car colours from
  `libs/shared/design-system/tokens/car-palette`, and the reservation actions. A second
  implementation of it inside `/admin` would be two renderings of one canvas,
  free to disagree about the same day — the exact failure the day overview's
  single-request payload (`overview.day`) exists to prevent.
- **A tab that only says "go somewhere else" would be under-delivering.** The
  brief asks for "admin pohled na den". What an admin actually needs while they
  are in the management section — who is parked where, where the queues are,
  whether the month is open — is a list, and a list is what `DataTable`
  (Task 22) already is. Everything on this tab is composed from parts that
  exist; nothing new was invented for it.
- **It reads the same procedure the lot screen will.** `overview.day` returns
  spots, holders, queue counts and the window state in one response, so the tab
  cannot drift from the grid: they are two renderings of one payload, not two
  payloads.

## How

- `AdminDayPanel` calls `api.overview.day` with `todayInPrague()`.
  `AdminDayScreen` takes `date` as a prop, so Task 25's date-navigation bar
  wires into this tab by changing `admin-day-panel.tsx` alone.
- The free/taken counts are derived from the rows
  (`spots.filter(row => row.reservation === null).length`), not from a separate
  field, so they cannot disagree with the table under them.
- The window banner is `./window-banner.tsx`, shared with nothing today but
  written to be: it takes a `MonthWindowOverview` and nothing else.
- The licence plate is deliberately **not** shown. `06-admin-overview.png` puts
  it on the car tile because the tile is a picture of a parked car; a management
  table listing every plate in the company is a different artefact, and the
  column earns nothing an admin asked for.
- The "Otevřít parkoviště" button is an `onOpenLot` callback, not an `href`, so
  the screen stays free of the router and testable with plain props.

## Risk

- **An admin comparing this tab to `06-admin-overview.png` will not find the
  grid.** Mitigated by the button, which is the first thing in the tab's header
  row. If the grid is wanted inside the tab later, the honest move is to lift
  Task 24's grid component and render it here — not to write a second one.
- **The date is fixed to today until Task 25 lands.** An admin cannot yet look
  at tomorrow from this tab. The prop is already there; only the control is
  missing.

## Re-read against the designs, fix round 1

Asked to look again with fresh eyes, I reopened `06-admin-overview.png` and
`01-lot-admin.png`. The premise holds and I would make the same call:

- `06` carries **no tab strip and no "Správa" heading**. Its eyebrow is
  `PŘEHLED PARKOVIŠTĚ`, not `ADMINISTRACE`. It is the lot screen as an admin
  sees it, filed under an admin-sounding name — not a panel that belongs inside
  `/admin`.
- The tab does reproduce everything of `06` above the grid: the eyebrow, the
  long Czech date, the two count pills, the green banner. The divergence is the
  grid itself, and one button — `Hromadná rezervace` becomes
  `Otevřít parkoviště`, because bulk booking is the lot screen's own action and
  duplicating its entry point here would be duplicating the flow behind it.
- Two implementations of one painted canvas is the outcome I was avoiding, and
  it is still the outcome of the alternative. If the product wants the grid in
  the tab, the fix is to render Task 24's component here.

**Unchanged.**
