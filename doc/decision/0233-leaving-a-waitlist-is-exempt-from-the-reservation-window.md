# 0233 – Leaving a waitlist is exempt from the reservation window

**Amends `doc/decision/0004-mvp-scope-includes-design-features.md`** (the Task 13
row: "enforcing the lock on create/join/leave").

## What

`waitlist.leave` no longer checks the reservation window. It is now in the same
class as `reservation.cancel`: always allowed, for any caller, in any month
state.

- `apps/garage/api/src/reservations/waitlist.service.ts` — the
  `policy.assertWindowOpen(...)` call is gone, and with it `leave`'s `settings`
  read and its `today` parameter, which had no other use.
- `libs/garage/contract/src/api/waitlist.ts` — contract-first, so this edit led:
  `leaveWaitlistContract` no longer declares `RESERVATIONS_LOCKED` or
  `OUT_OF_HORIZON`. Its declared errors are `NOT_FOUND` and `CONFLICT`.

`waitlist.join` is unchanged. Joining is taking something; it stays gated.

## Why

**The rule as written made leaving impossible for the entire live life of every
queue, under the configuration the product ships with.**

`monthLockState` (`libs/garage/shared-types/src/lib/reservation-window.ts:100-102`)
returns `LOCKED` as soon as `today >= startOfMonth(targetDate)` — the window
closes at the *start* of the target month, not its end, which that file's own
header calls out as load-bearing. The shipped defaults are `AUTO` and
`openDaysBefore = 7` (`domain-constants.ts:42,49`).

So from the 1st of any month, every day in that month is `LOCKED`. And the
target month is *exactly and only* the period in which a queue for it can be
promoted: promotion happens when the holder cancels, and holders cancel days
they are no longer coming in for. Before the month begins, a queue can exist but
almost never fires; once it can fire, nobody may leave it.

The consequences follow directly, and none of them is recoverable by the user:

- They cannot withdraw. There is no other route out — `leave` is the only one.
- They cannot cancel their way out either: there is nothing to cancel yet.
- When the spot frees they are **auto-promoted into a reservation they had
  explicitly asked to leave**, get a Slack notification about it, and have to
  remember to cancel it.
- The spot is then held by somebody who does not want it, instead of passing to
  the next person queued — which is the queue failing at its one job.

**The reasoning that put the check there cuts the other way.** The comment in
`waitlist.service.ts` and `0004`'s row argued that leaving "reshuffles everybody
behind you, which is a change to other people's positions, not a spot being
given back". But everyone behind you moves **up**. That is the same direction a
cancellation moves people, and cancellation is explicitly, deliberately allowed
in a locked month for exactly that reason: a closed window stops people *taking*
spots, not giving them back. Leaving a queue gives a position back.

**`0004`'s line was reasoning about the pre-window period.** Read in context, it
groups create/join/leave as "writes a normal user may not make in a month that
is not open yet" — the case where somebody tries to get ahead of the window. It
was not written against the state above, because that state was never run: the
only test of the branch reached `LOCKED` through the `FORCE_LOCKED` **admin
override**, and every db-spec fixture uses a `TODAY` in the month *before* its
target day (`reservation-harness.ts:219,229`). The `AUTO` timeline in which this
bites was exercised nowhere.

## How it is kept true

`waitlist.db.spec.ts` — "is allowed in a month AUTO has locked — the only
timeline a live queue is ever in" — builds the target day from the **real**
`todayInPrague()` and the settings actually in the database, asserts
`monthLockState(...)` is `LOCKED` before it starts, and then leaves. It fails
with `RESERVATIONS_LOCKED` if the check is put back. It replaces the
`FORCE_LOCKED` test, which is not merely weaker: passing it was compatible with
the defect.

## Risk

An admin who has set `FORCE_LOCKED` to freeze a month can no longer stop people
leaving queues in it. That is the intended reading — `FORCE_LOCKED` freezes
*allocation*, and a departure allocates nothing — but it is a behaviour change
for an override that previously did stop it. Everything a departure can do is
shorten a queue and move the people behind up; the reservation that queue is
waiting on is untouched.
