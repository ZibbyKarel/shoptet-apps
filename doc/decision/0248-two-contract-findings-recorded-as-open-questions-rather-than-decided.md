# 0248 – Two contract findings recorded as open questions rather than decided

**Date:** 2026-09-03 · **Status:** open · **Task:** final-review fix round, shard contract-auth (M-4, M-6)

Both were raised by the final review, both are real, and neither was changed in
that round. This record exists so that "we looked at it and left it" is
distinguishable from "nobody read it" — which is the whole failure mode the fix
round was called for.

## M-6 — `admin.window.update({})` silently resets the reservation window

`libs/garage/contract/src/api/reservation-window.ts:31`.

`updateReservationWindowSettingsInputSchema` **is**
`reservationWindowSettingsSchema`, whose two fields both carry `.default()`. So
`z.input` makes both optional to a client, and `admin.window.update({})` parses
successfully to `{ openDaysBefore: 7, lockMode: 'AUTO' }` — the defaults — and
writes them over whatever was stored.

The file documents this as PUT semantics and says "Send both". That is a coherent
position, and the reasoning given for it (two fields, one form, replacement is
easier to reason about than a patch whose result depends on invisible state) is
sound. What the review is right about is that **the contract cannot enforce it**:
"send both" is a sentence, not a schema, and `lockMode` decides whether anybody
can book at all. A request that omits a field is indistinguishable from one that
asked for the default, so the failure is silent and its blast radius is the whole
booking system.

**Why it was not changed here.** Making the input explicitly required —
`reservationWindowSettingsSchema` without the defaults, or a
`z.strictObject` over the two fields — is an **API contract change**: it moves an
accepted request shape into `VALIDATION_FAILED`, and the admin settings form in
`apps/garage/web` is the client that would have to be checked against it. The fix round
that found this owns `libs/garage/contract` and explicitly does not own `apps/`, and
contract-first means the contract edit leads and the handler follows — which is
exactly the sequencing that cannot be done from one side of that boundary.

**The question to answer, not the answer:** should the update procedure take a
shape where both fields are required (so an omission is rejected rather than
defaulted), and if so, does `apps/garage/web`'s admin form already send both? A
follow-up needs to change both sides in one commit.

## M-4 — a tautological assertion in `router.spec.ts`

`libs/garage/contract/src/api/router.spec.ts:196-208`. The test *declares both window
errors on every write gated by the window* asserts against the spec file's own
`EXPECTED_ERROR_CODES` table rather than against the contract.

Left as it is. It is harmless in fact — `:178-185` binds that table to the real
`errorMap`, so the table cannot drift from the contract without the earlier test
failing — but it reads as coverage it is not providing on its own. Recorded
because "harmless today, because of a binding twenty lines up" is precisely the
kind of thing that stops being true quietly, and the next person to touch that
file should either fold the two assertions together or say why they are separate.
