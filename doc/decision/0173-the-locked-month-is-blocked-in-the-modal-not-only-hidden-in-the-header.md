# 0173 – The locked month is blocked in the modal, not only hidden in the header

**Date:** 2026-09-03 · **Status:** accepted, **amended 2026-09-03 (fix round 1)** ·
**Affects:** `apps/garage/web/src/lot/bulk-modal/bulk-modal.tsx`, `apps/garage/web/src/lot/lot-screen/lot-screen.tsx`
**Follows on from:** `doc/decision/0120-*` · **Amended by:** `doc/decision/0175-*` (which field),
`doc/decision/0176-*` (where the gate sits)

> **Two claims in the first version of this record were measured and found false**, and both are
> corrected in place below rather than left standing:
>
> - *"the day's answer is the month's answer"* — it is not. `canReserve` is per-**day**, and using
>   it here switched bulk booking off on every weekend, Czech holiday and past day of an open
>   month. The gate now reads `canReserveMonth`, a new contract field: `doc/decision/0175-*`.
> - *"ahead of all three steps"* — that ordering also refused the **result** step, replacing a
>   finished comparison with copy saying nothing was created. The gate now sits after the result
>   step: `doc/decision/0176-*`.
>
> What survives unchanged is this record's actual subject: hiding a control is not enforcement, so
> the modal refuses on its own, and the two halves are pinned by separate tests.

## What

`day.canReserveMonth` is used **twice**, for two different jobs:

1. `LotHeader`'s `showBulk` — the entry point is absent for a normal user in a locked month.
2. `BulkReservationModal`'s `canReserveMonth` prop — when it is `false` the modal renders a refusal
   ("Rezervace jsou uzamčené") **instead of** its flow: no grid, no schedule, no call to action,
   and therefore no `previewBulk` and no `confirmBulk`.

The second check runs ahead of the two steps that can still write — picking days and confirming —
so it catches a window that closes while the modal is already open. It deliberately runs **after**
the result step (`doc/decision/0176-*`).

## Why

**Hiding a control is not enforcement, and the two halves fail in different situations.** The
header's `showBulk` answers "should this user be invited to start", once, at render. The modal's
`canReserveMonth` answers "may this flow proceed", continuously. Only the second covers the case
that actually happens: the user opens the modal on an open month, the day query refetches (a
realtime broadcast, a window focus, an admin changing the window), `canReserveMonth` flips, and the
user is now holding a proposal for a month they may no longer write to. A hidden button is behind
them at that point.

**Neither is authorisation.** The API's window check is (`doc/decision/0120-*` —
`canReserveMonth` is the backend's answer, not a re-derivation), and `confirmBulk` answers
`RESERVATIONS_LOCKED`
regardless of what the client believes. What the client owes is (a) not inviting an action that
cannot succeed, (b) not letting a flow continue into a request that will be refused, and (c) saying
so in words when the API refuses anyway. All three exist; (c) is `doc/decision/0171-*`'s
`errorLocked`.

**~~Why the day's answer stands for the month's.~~ Retracted.** The first version argued that
because the window is monthly and the grid shows that month, `canReserve` for the anchor day *is*
the answer for the month. The premise is false: `canReserve` also carries two per-day rules — a
past date and a non-business day — that say nothing about the window. The reasoning had the right
instinct (read a backend field, never re-derive from `window.state`) and the wrong field. The
backend now answers the question this gate actually asks, as `canReserveMonth`;
`doc/decision/0175-*` has the full argument and the cost the mistake carried.

**One authority, not a guard plus a rendering branch.** The obvious extra defence — an
`if (!canReserveMonth) return;` at the top of the mutate handlers — was written and then removed. With
the body already replaced by the refusal there is no control left to click, so nothing could ever
falsify it, and `doc/decision/0092-*` §"One authority" is this project's record of what an
unfalsifiable guarantee costs: two mechanisms, either sufficient, neither killable by a test, and
every document pointing at only one of them. The rendering branch is the single authority and a
named test fails when it is deleted.

## How

- `apps/garage/web/src/lot/lot-screen/lot-screen.tsx` — `showBulk={day.canReserveMonth}` and
  `canReserveMonth={day.canReserveMonth}` on the modal, with the reason at the call site.
- `apps/garage/web/src/lot/bulk-modal/bulk-modal.tsx` — the `if (!canReserveMonth)` branch sits above the schedule
  and select branches and below the result branch.
- Proven separately, as two named tests in `bulk-modal.spec.tsx`:
  - *"refuses the whole flow when the caller may not reserve in this month"* — the modal opened
    with `canReserveMonth: false` shows the refusal, has no column headers and no CTA, and
    `previewBulk` was never called. `LotHeader` and `showBulk` are not in this test at all, which
    is what makes it enforcement tested *without* hiding.
  - *"stops a confirmation whose window closed while the modal was open"* — the flow is driven to
    the proposal with `canReserveMonth: true`, the component is re-rendered with `false`, and the
    confirm button is gone with `confirmBulk` never called.
  The hidden half stays in `lot-screen.spec.tsx` › *"hides the button when canReserveMonth is
  false, even though the window is OPEN"*, and the wiring between them in *"hands the modal the
  backend's own canReserveMonth, so a window closing under it is refused"*.

## Risk

**An admin sees the modal in a locked month, because `canReserveMonth` is `true` for them** — that
is the intended behaviour (`doc/decision/0120-*`), and the API agrees, so nothing here special-cases
a role.

**A window that closes mid-flow throws the selection away.** The refusal replaces the body, and
going back is not offered; if the window reopens the user starts again. Preserving a selection
across a lock would mean keeping state for a request that may never become legal, which is a worse
trade than a re-pick.

**What the gate must never throw away is a finished result.** The first version's §Risk anticipated
only the selection, and that omission is exactly how the result step ended up behind the refusal.
`doc/decision/0176-*` is the correction and carries the two tests that hold it.
