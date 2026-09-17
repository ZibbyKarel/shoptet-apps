# 0022 – Realtime event names and the rule "one transaction = one event"

## What

The set of `@garage/contract/realtime` events is closed and named by a
single rule:

- **outbound** (server → client): `<subject>:<past-participle>` — `cell:locked`,
  `cell:unlocked`, `reservation:created`, `reservation:cancelled`,
  `reservation:reassigned`, `waitlist:updated`,
- **inbound** (client → server): `<subject>:<imperative>` — `day:subscribe`,
  `day:unsubscribe`, `cell:lock`, `cell:unlock`.

A colon as separator, lowercase, subject in the singular, both sides disjoint.

Additionally:

1. **One committed transaction produces exactly one event.** A cancellation
   that promotes the first waitlist entry sends `reservation:reassigned`
   **instead of** `reservation:cancelled`.
2. `reservation:reassigned` carries `cause` from the closed enum
   `RESERVATION_REASSIGN_CAUSES`.
3. Realtime **does not broadcast the reservation-window state.** A deliberate
   gap, see Risk.

## Why

**Past tense outbound is information, not style.** Task 15 broadcasts only
after the commit; the past participle is what holds that fact in the name. A
client that receives `reservation:created` knows it can no longer be taken
back. The imperative inbound makes the event's direction readable from the
name alone, with no need to check its type, and above all it prevents name
collisions: `cell:lock` (a request) and `cell:locked` (a fact) can't be
confused, whereas a single `cell:lock` used in both directions would mean two
different things depending on who sent it.

**`cell` is the only non-domain subject, and that's correct.** The lock holds
a pair (`parkingSpotId`, `date`) — one cell of the day × spot grid — and
neither `spot:` nor `reservation:` names that pair. `spot:locked` would read
as "this spot is locked every day", which is a different (and non-existent)
thing. `plan.md` and the Task 24 brief already call it "cell-lock", so
renaming it would also decouple the code from the brief. The risk of
confusing it with `MonthLockState.LOCKED` is real and is addressed with
documentation in both places, not with a rename — see Risk.

**One transaction = one event is about what the user sees.** Cancel + create
would, for every client in the room, first flash the cell empty and then
repaint it; besides the flicker, it would mean a state existed between two
packets that the database never actually had.

The rule has a consequence worth stating out loud: a promotion shortened the
waitlist, but `waitlist:updated` is **not** sent for it — that would be a
second event from the same transaction. The non-null `fromWaitlistEntryId` is
that information; the client decrements its own count, or reloads the day.
The alternative (sending both) would violate the rule and would push the same
flicker one level down, onto the waitlist badge.

**`reservation:reassigned` is its own event** because of ruling `window-1`: an
automatic promotion is a system action, and the reservation-window lock does
not apply to it. If it arrived as `reservation:created`, a client in a locked
month would have to conclude someone bypassed the window. The name says it
wasn't a user action; `cause` says which system action it was — the UI needs
this too, since "you got a spot from the waitlist" is a different message from
"reserved".

**`cause` is an enum with a single value.** A boolean couldn't be extended
without a breaking change, and `ADMIN_REASSIGNMENT` has no emitter today — the
API contract has no procedure that moves a reservation between users, and an
enum member nobody ever produces is the same over-declaration
`doc/decision/0021-*` forbids. The enum is a compromise: extensible, yet
without a dead value.

## How

Payloads live in `libs/garage/contract/src/realtime/events.ts` and `commands.ts`, all
built on `cellRefSchema` (`date` + `parkingSpotId`). `date` is repeated in
every payload even though the room implies it: a client is often connected to
several day rooms, and the Socket.io handler doesn't tell it which room a
message arrived through.

`RESERVATION_REASSIGN_CAUSES` and `CELL_LOCK_RESULTS` live in
`libs/garage/shared-types` next to the other enums; the contract just wraps them in
`z.enum(...)` — the same pattern as `PARKING_GROUPS`
(`doc/decision/0016-*`).

Tests pin **the exact composition of both sets** in `event-maps.spec.ts` with a
hand-written list, so adding, renaming, or losing an event shows up in the
diff, and they check the naming convention with the regex `^[a-z]+:[a-z]+$` as
well as the disjointness of both directions.

## Risk

**Confusing `cell:locked` with `MonthLockState.LOCKED`.** The word "locked"
has two meanings in this project: a whole month's reservation window being
closed, and a thirty-second editing lock on a single cell. Mitigation: no
realtime payload carries the window state, both meanings are explicitly
distinguished in `doc/contract.md` §Realtime and in the header of
`events.ts`, and the names differ (`RESERVATIONS_LOCKED` vs. `cell:locked`).
The residual risk mostly falls on someone new to the code; renaming to
`hold:*` would remove it, at the cost of a mismatch with `plan.md` and the
Task 24 brief.

**"One transaction = one event" is a rule the contract cannot enforce.** Task
15 could send both events and nothing would stop it. Mitigation: the rule is
stated in `doc/contract.md` and in a comment next to
`reservationCancelledEventSchema`, and a test there at least verifies that a
cancellation payload has **neither** a `promoted` field nor a new holder — so
anyone tempted to send both has nothing to attach it to.

**The missing `window:updated`.** When an admin changes the window, the
banner on connected clients only catches up on the next `overview.day`.
Deliberate: the Task 15 brief has no window broadcast, and adding an event
nobody emits is the same mistake as declaring an unreachable error code. Once
it turns out to matter, `window:updated` gets added **to the contract first**.
Note that it would be the first event that doesn't belong to a day room — it
would need a global broadcast, not `io.to(roomForDate(...))`.
