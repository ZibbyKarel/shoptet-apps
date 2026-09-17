# The bulk-reservation modal

`Hromadná rezervace` is the front end of the bulk allocator
(`doc/bulk-reservation.md`, `doc/decision/0090-*`–`0092-*`). It lives entirely in
`apps/garage/web/src/lot/`:

| file | what it is |
| --- | --- |
| `bulk-view.ts` | every decision, as pure functions — no DOM, no query client |
| `bulk-modal.tsx` | the connected component: three steps, two mutations, one invalidation |
| `bulk-view.spec.ts` | the decisions |
| `bulk-modal.spec.tsx` | the steps, the copy, the cache, the block |

The entry point is `LotHeader`'s "Hromadná rezervace" button, wired in `lot-screen.tsx`. The design
is `doc/design/screens/10-modal-bulk.png`.

## The three steps

### 1 · Choosing the days

A month grid for the month of the lot screen's current day, columns `PO ÚT ST ČT PÁ SO NE`, Monday
first, weekends in the two right-hand columns. `buildMonthGrid(anchor, today)` lays it out: the
slots before the 1st and after the last day are empty, every row has exactly seven slots, and every
slot carries a key that includes the month so a re-layout cannot carry one month's cell state onto
another's.

The `SO` and `NE` heads are recessed to match their cells. Which columns those are is not hard-coded
as "the last two": `weekendColumns(grid)` reads the flag the grid's own cells already carry, so the
heading and the cells under it cannot disagree — the one way this could have gone wrong is a grid
that starts its week somewhere other than Monday, and then the constant would be wrong while the
derived answer stays right.

A day is selectable unless:

| | reason | why the client refuses it |
| --- | --- | --- |
| weekend | `WEEKEND` | the allocator would answer `UNAVAILABLE / NOT_A_BUSINESS_DAY` |
| Czech public holiday | `HOLIDAY` | same |
| already past | `PAST` | one past day fails the **whole** batch with `PAST_DATE` |

The checks run in that order, which is the allocator's own (`doc/decision/0090-*`, following
`0064-*`): a Saturday is the most durable fact about a day, so a past Saturday reads as a weekend
rather than as "in the past".

Under the grid: "Víkendy a svátky nelze vybrat." and the preferred-spot line, which has **five**
states rather than two — see `doc/decision/0172-*`. The fifth is `unknown`: when the profile or the
spot list fails to load, the line says so ("nepodařilo se zjistit") instead of promising a name that
is never coming. A failed read short-circuits ahead of everything else, so it can never be mistaken
for "still loading" or for "no preferred spot". The call to action reads "Vyberte dny" (disabled) until
something is picked, then "Vygenerovat rozvrh (N dní)".

### 2 · The proposed schedule

`reservation.previewBulk` with the picked days, ascending. It writes nothing. Each day becomes a row
of `datum · den v týdnu`, the allocated spot, and a badge:

| outcome | badge | tone |
| --- | --- | --- |
| assigned, preferred spot | `Rezervováno · preferované` | green |
| assigned, any other spot | `Rezervováno` | blue |
| queued | `N. ve frontě` | yellow |
| unavailable | `Už máte rezervaci` / `Víkend nebo svátek` / `Žádné místo` | neutral |

Below them, "X dní s místem, Y dní ve frontě." — an ICU plural, so a one-day batch reads "1 den"
rather than "1 dní". The two numbers are **quoted from the preview's own `summary`**, not counted
from the rows on screen: the server states its totals in the same payload, and a client that
recounted them would be a second implementation of the allocator's classification, free to drift
from it. "Zpět na výběr" returns to the grid with the selection intact.

### 3 · The result, laid against the proposal

`reservation.confirmBulk` with the days **of the proposal on screen** — `proposal.days`, not the
set of cells that were clicked. In the ordinary case the two are the same list; they part company if
the preview is ever narrowed or reordered server-side, and then the schedule the user agreed to is
the one that must be sent. The plan itself is not sent: the server does not receive, and would not
trust, the allocation the client is holding. The modal then compares the two, day by day, and does not
close until the user dismisses it. This is the point of the whole flow and it has its own record:
`doc/decision/0170-*`.

- identical → "Zapsali jsme vás přesně podle návrhu."
- otherwise → a `role="alert"` panel listing **only** the days that moved, each as
  `Návrh: …` / `Skutečnost: …`, above the confirmed schedule.

## The cache

On a successful confirmation, `overview.day` is invalidated for **every day in the batch**,
including days reported `UNAVAILABLE`. Over-invalidating is nearly free — an unmounted query is only
marked stale — and the alternative asks the client to decide which days the server touched, which is
the re-derivation `doc/decision/0120-*` rules out.

The refetch is not redundant with the realtime broadcast. Since Task 15 the bulk path's domain
events reach the real Socket.io publisher, so other clients viewing an affected day do get patched
from the broadcast. This client still refetches, for the same reason `LotScreen`'s
`onMutationSuccess` does: `canReserve` and `viewerReservationId` are viewer-relative and no
broadcast can carry them, and the gateway need not echo an event to its sender.

## Failures

Every failure is read through `toContractError` and rendered from the `bulk` namespace, one
sentence per code — never from the shared `errors` namespace, whose `VALIDATION_FAILED` says
"weekend or holiday", which is never a bulk request's reason. See `doc/decision/0171-*` for the
table and the reasoning. A failed confirmation leaves the user on the proposal, because there is no
result to show.

## The locked month

Two separate mechanisms, and they cover different situations
(`doc/decision/0173-*`): the header hides the button when `day.canReserveMonth` is `false`, and the
modal refuses its flow when the same prop is `false` — which is what catches a window closing while
the modal is already open. Neither is authorisation; the API's window check is.

The field is `canReserveMonth`, not `canReserve`. `canReserve` is per-**day** and also answers
"past" and "weekend or holiday", so reading it here switched bulk booking off on roughly a third of
the calendar of an open month — the design's own screenshot has the modal open on a Czech public
holiday. `canReserveMonth` is a separate contract field carrying the window and the admin exemption
and nothing about the anchor day: `doc/decision/0175-*`.

The refusal sits **below** the result step and above the other two, so it guards entry and
confirmation and never the display of a confirmation that already happened:
`doc/decision/0176-*`.

## What it never imports

Data through `@garage/query` and `@garage/api-client`, copy and dates through
`@garage/i18n`, UI through `@garage/design-system/primitives`. Nothing here names
`@tanstack/react-query`, `@orpc/client`, `next-intl` or `socket.io-client` — the wrapper rule
(`doc/wrappers.md`), enforced by `no-restricted-imports`.

The grid's cells are plain `<button>`s inside a `<table>` rather than a design-system primitive: a
month grid is domain-adjacent layout, and a compound that knew about business days would stop being
presentation-only (`plan.md`, §"Design-system-first"). Their colours, radii and focus ring are token
utilities throughout.
