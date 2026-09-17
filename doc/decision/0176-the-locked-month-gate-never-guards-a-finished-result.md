# 0176 – The locked-month gate guards entry and confirmation, never the display of a finished result

**Date:** 2026-09-03 · **Status:** accepted · **Affects:** `apps/garage/web/src/lot/bulk-modal/bulk-modal.tsx`
**Follows on from:** `doc/decision/0170-*`, `doc/decision/0173-*`, `doc/decision/0175-*`

## What

`BulkReservationModal`'s branches run in this order, and the order is load-bearing:

1. **result** — `result !== null`
2. **blocked** — `!canReserveMonth`
3. **schedule** — `proposal !== null`
4. **select**

The refusal therefore covers the two steps that can still *write* — picking days and confirming —
and never the step that only *reports* writes that already happened.

## Why

**The previous order deleted the comparison that the whole two-step flow exists to protect.** The
refusal sat ahead of all three steps, on the reasoning of `doc/decision/0173-*` that a window
closing mid-flow must kill the confirm. That is right for steps 3 and 4 and wrong for step 1, and
the wrongness is not theoretical — it was constructed and run in review:

1. The user picks days, previews, confirms. `confirmBulk` succeeds; one day came back as a queue
   place where the proposal promised a spot.
2. The success handler invalidates `overview.day` for **every** day in the batch, the anchor day
   included. That refetch goes out immediately.
3. Between the confirm and that refetch, the month locks — an admin flips `lockMode`, the
   `openDaysBefore` cutoff passes, or the clock rolls past midnight. `canReserveMonth` comes back
   `false`.
4. `LotScreen` re-renders and the refusal wins, replacing the difference panel with
   *"Rezervace na tento měsíc jsou uzamčené — hromadnou rezervaci teď založit nelze."*

The reservations and the waitlist entries **exist on the server**, and the modal is telling the
user a bulk reservation cannot be created. The one place the difference was ever shown is destroyed
without a trace, and the user is left believing nothing happened. `doc/decision/0170-*` calls a
silent substitution worse than having no proposal at all; this is that outcome arriving through the
back door, from the mechanism meant to protect the user.

**A result is not an action.** Steps 3 and 4 offer buttons that write; a closed window makes those
buttons a request the API will refuse, so refusing early is a kindness. Step 1 offers "Hotovo". There
is nothing there for a closed window to prevent, so refusing there prevents only the user from
finding out what happened.

**Nothing is weakened by the reorder.** The confirm button does not exist on the result step, and
`result` is only ever set from `confirmBulk`'s success handler — so reaching the result step at all
means the write already went through. There is no path from step 1 back into a mutation; the modal
resets to step 4 on its next opening (`[open, month]`).

**The narrower framing that replaces `doc/decision/0173-*`'s "ahead of every step".** The gate's
subject is *"may this caller start or complete a bulk reservation"*, not *"may this modal be on
screen"*. Stated that way, the placement follows without further argument.

## How

- `apps/garage/web/src/lot/bulk-modal/bulk-modal.tsx` — the `if (result !== null)` block moved above
  `if (!canReserveMonth)`, both carrying the reasoning at the branch.
- Two named tests in `bulk-modal.spec.tsx`, because nothing else distinguishes the two orderings:
  - *"keeps the comparison on screen when the window closes after the confirmation"* — drives a
    differing confirmation, waits for the `role="alert"` panel, re-renders with
    `canReserveMonth={false}`, and asserts the dialog is still "Rozvrh potvrzen", the alert still
    reads "Rozvrh se od návrhu liší", and the locked sentence is absent.
  - *"keeps an unchanged result on screen too, not only a differing one"* — the same for the
    matching case, so the fix cannot be narrowed to the alert branch by accident.
- The two refusal tests from `doc/decision/0173-*` are unchanged and still pass: the gate still
  fires at entry and still fires mid-flow before a confirmation.

## Risk

**A user can read a result for a month that has since locked, and its "Hotovo" leads back to a lot
screen with no bulk button.** That is the truthful sequence of events and the window banner on the
screen behind already explains the second half. The alternative is lying about the first half.

**The ordering is now a real invariant with no type-level protection.** Moving the refusal back up —
a plausible "tidy the guards to the top" refactor — reintroduces the defect. Both tests above fail
if it happens, and the branch comments say why they exist.
