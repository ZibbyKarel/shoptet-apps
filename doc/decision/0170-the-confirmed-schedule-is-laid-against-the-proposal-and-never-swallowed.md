# 0170 – The confirmed schedule is laid against the proposal, and a difference is never swallowed

**Date:** 2026-09-03 · **Status:** accepted · **Affects:** `apps/garage/web/src/lot/bulk-*`
**Follows on from:** `doc/decision/0019-*`, `doc/decision/0092-*`

## What

`BulkReservationModal` has **three** steps, not two. After `reservation.confirmBulk` returns, the
modal does not close: it moves to a result step that compares the confirmation with the proposal it
showed, day by day, and

- when every day matches, says so — "Zapsali jsme vás přesně podle návrhu.";
- when any day does not, renders a `role="alert"` panel above the schedule listing **only** the
  days that moved, each as `Návrh: …` / `Skutečnost: …`.

The comparison is `diffBulkSchedule` in `apps/garage/web/src/lot/bulk-modal/bulk-view.ts`. Two answers for one date
count as the same when the outcome kind, the spot **id**, the preferred-spot flag, the queue
position and the unavailable reason all agree. `reservationId` / `waitlistEntryId` are excluded:
they exist only on the result, and their absence from the proposal is not a difference a user cares
about. A date that appears on one side only is reported too, with `null` on the other.

The user closes the result step deliberately ("Hotovo"). Nothing auto-dismisses it.

## Why

**The gap between the preview and the confirmation is real, deliberate and documented.**
`doc/decision/0092-*` leaves the read-to-write race open on purpose — locking every candidate spot
for a 31-day batch would serialise every other reservation in the building behind it, and would
hand `confirmBulk` a return edge against the cancel path. The consequence is stated there in so many
words: *"a preview can promise a spot and the confirmation can hand back a queue place instead. The
UI is built for that."* This record is that half.

**A modal that proposes one thing and confirms another silently is worse than one with no
proposal.** Without a proposal the user reads the result with fresh eyes. With a proposal they have
already formed a belief — "I have E2.92 on the 1st" — and a silent substitution leaves that belief
in place while the database says otherwise. The failure surfaces days later, at a barrier, which is
the worst possible place to discover it.

**The server cannot do this comparison.** `confirmBulk` takes the same input as `previewBulk` and
deliberately does **not** receive the plan the client is holding (`libs/garage/contract/src/api/bulk.ts`,
`doc/decision/0019-*`): trusting a client-supplied plan would be trusting a client-supplied
allocation. So the client is the only party that holds both halves, and the two outputs were given
the same shape precisely so it could zip them.

**Auto-closing on success would have made the comparison unreachable in practice.** Every other
write on the lot screen closes its dialog on success (`onMutationSuccess`), and copying that habit
here was the tempting move. It would have meant the difference panel rendered for one frame and
then disappeared. The result step is therefore explicitly terminal: `onClose` is only ever called by
the user.

**Why a `role="alert"` and not a badge on the row.** The rows already carry badges, and a changed
row's new badge looks exactly like a row that was always that way. The difference is information the
user did not ask for and must not have to hunt for, which is what `alert` is for.

## How

- `apps/garage/web/src/lot/bulk-modal/bulk-view.ts` — `sameOutcome` and `diffBulkSchedule`, pure and sorted
  ascending; `toScheduleRows` re-sorts both lists into date order so a reader comparing them does
  not also have to account for two orderings.
- `apps/garage/web/src/lot/bulk-modal/bulk-modal.tsx` — the result step; `describeOutcome` renders one side of a
  difference as one phrase, with `resultChangedMissing` ("nic") for the `null` side.
- `bulk-view.spec.ts` covers the comparison itself — a matching pair, a spot that became a queue
  place, a queue position that moved, a day on one side only, the ordering, and the fact that
  matching days stay out of the list. `bulk-modal.spec.tsx` covers what the user sees: the
  unchanged sentence, the alert with `Návrh:` / `Skutečnost:` and the untouched day *absent* from
  it, and that `onClose` is not called on success.

## Risk

**The proposal is client state, so a reload between the two steps loses it.** The modal resets when
it reopens (a stale month's selection would be a `VALIDATION_FAILED` batch), and a reload therefore
means the user restarts the flow rather than seeing a comparison against nothing. That is the right
direction — an empty proposal would make *every* day look changed — but it does mean the guarantee
is "the difference is shown to the user who confirmed it in this session", not "forever".

**A difference the user cannot act on.** The result step explains what happened; it does not offer
"try the changed days again". That is deliberate for the MVP — the days are already booked or
queued, and a retry is a new bulk request — but it is the first thing to add if users ask.
