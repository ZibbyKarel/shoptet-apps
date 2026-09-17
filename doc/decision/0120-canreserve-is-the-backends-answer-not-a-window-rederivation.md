# 0120 – `canReserve` is the backend's answer; the lot never re-derives it from the window

## What

Every "may this caller act on this day?" decision on the parking screen reads
`dayOverviewOutputSchema.canReserve` and nothing else:

- a free bay is drawn as `free` (a `+`, clickable) when `canReserve`, and as
  `window-locked` (the `⊘` tile, opening an explanatory modal) when not;
- the modal's primary action — `Rezervovat` or `Přidat se do fronty` — is
  present when `canReserve` and **absent** when not;
- the header's `Hromadná rezervace` button follows the same flag.

The screen does **not** compute `state === 'OPEN' || isAdmin`, which is what
the finished design does (`ruleLocked = !windowOpen && !admin`).

`canReserve` gates only the two **writes the window blocks** — creating a
reservation and joining a queue, which are the two procedures that declare
`OUT_OF_HORIZON` and `RESERVATIONS_LOCKED`. It does not gate cancelling.

## Why

The contract says so, in the schema, unprompted:

> Whether **this caller** may create a reservation on **this day**, already
> accounting for the window, the admin exemption, past dates and business days.
> **The frontend must not re-derive this from `window`**: an admin is not
> restricted by the window at all, and that fact lives on the backend.

The design's predicate is not merely a duplicate, it is a narrower one. It
agrees with `canReserve` on the two window states and disagrees on the two
cases it has no concept of:

| day | `canReserve` | design's `ruleLocked` | who is right |
| --- | --- | --- | --- |
| open month, normal user | true | bookable | agree |
| locked month, normal user | false | locked | agree |
| locked month, admin | true | bookable | agree |
| **a past date, anybody** | false | bookable | contract |
| **a weekend or holiday, anybody** | false | bookable | contract |

The last two are not hypothetical: `reservation.create` declares `PAST_DATE`,
and `doc/decision/0064-*` makes a non-business day a `VALIDATION_FAILED`. Under
the design's predicate an admin opening a Saturday would be offered a `+` on
every bay and get a contract error on every click. Under `canReserve` they see
`⊘` and a modal that explains.

The asymmetry with cancelling is the contract's too. `reservation.cancel`
declares **no window errors at all**, and says why: "a locked window stops
people from taking spots, not from giving them back." So `Zrušit rezervaci`
is gated on holding the reservation (or being an admin), never on the window —
which is also exactly what the Task 24 brief asks for.

## Consequences

- The reservation-window rules exist in one place, the backend, and the screen
  cannot drift from them. An admin exemption changing shape is a backend change
  with no frontend counterpart.
- The `⊘` tile now means "you cannot book this day", which is broader than the
  design's "this month is locked". The tile's copy stays the design's
  ("rezervace uzamčeny") and the *modal* carries the explanation, so the
  broader meaning costs no visual change.
- A day the backend refuses for a reason the banner does not describe — a
  weekend — is explained by the sticky day bar instead, which is why
  `toDayNoteView` gained a `weekend` case the design does not have.

## Alternatives rejected

**Transcribe the design's predicate.** Rejected: it ships two of the five
window-ish rules and silently disagrees with the backend on the other three.
`doc/decision/0004-*` gives the design the casting vote on *visuals*; it does
not make the design an authority on authorisation.

**Use `canReserve` for tiles but `window.state` for the modal.** Rejected as
two sources for one decision — the shape of bug where a tile is inert and its
modal offers the action anyway.

## Verified by

`apps/garage/web/src/lot/lot-view.spec.ts`, "reads canReserve from the payload rather
than re-deriving it from the window", which asserts **both** directions
(`canReserve: false, isAdmin: true` is still `window-locked`). Measured, not
estimated (mutants M2 and M18 in the task report): mutating `toSpotView`'s
appearance ternary to drop the `window-locked` branch fails **2** tests —
"draws a free spot as window-locked and offers the explanation when canReserve
is false" and "reads canReserve from the payload rather than re-deriving it
from the window"; mutating `spot-dialog.tsx`'s `showPrimary` to drop
`canReserve` fails **1** — "hides joining, and shows the yellow note, in a
locked month".
