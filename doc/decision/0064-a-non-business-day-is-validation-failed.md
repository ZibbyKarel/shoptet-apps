# 0064 – A weekend or public holiday is `VALIDATION_FAILED`, not a new error code

**Date:** 2026-09-02 · **Status:** accepted · **Follows on from:** `doc/decision/0019-*`

## What

`ReservationPolicy.assertBusinessDay` rejects a weekend or a Czech public holiday with the
existing contract code **`VALIDATION_FAILED`**, carrying
`details: { date, reason: 'NOT_A_BUSINESS_DAY' }`. `ERROR_CODES` is **not** extended.

The check applies to `reservation.create` and `waitlist.join`, and it applies to **everybody,
admins included** — the admin exemption is from the reservation *window*, not from the fact that
the lot is a workplace car park.

## Why

**There was a real gap to close.** `DayOverviewService.canReserve` already answers `false` for a
Saturday (`doc/api-modules.md` §`canReserve`, rule 2). A backend that then accepted the write
would be contradicting its own screen — and the screen is not the enforcement, so the day would
genuinely be bookable by anyone who posted the request directly.

**Adding a code was the obvious move, and it is the wrong one.** `ERROR_CODES` is a closed enum
shared by the contract, every backend throw site, and `libs/shared/i18n`'s Czech catalogue. Widening it
means touching three libs and Task 17's shipped copy for a case Task 13's own brief does not list
among its rules — a large blast radius for a small fact.

**It did not need to be widened, because Task 17 already made this decision.** The Czech copy for
`VALIDATION_FAILED` reads *"Požadavek porušuje pravidlo rezervací (např. víkend nebo svátek)"* —
the weekend is literally the example it names. The code already means "structurally valid, but it
violates a domain rule", the wording already covers this rule, and the user-facing sentence is
already correct. Inventing `NOT_A_BUSINESS_DAY` would have produced a second code with the same
Czech sentence.

**`reason` in `details` keeps the information.** A client that wants to distinguish a holiday from
another `VALIDATION_FAILED` can read it, and it matches the name the bulk flow already uses for the
same fact (`BULK_UNAVAILABLE_REASONS.NOT_A_BUSINESS_DAY`), so the two halves of the product call it
the same thing.

**Why not in the schema.** `doc/decision/0019-*` settled this: day eligibility is the same category
as "not in the past" and "inside the open window", both of which the window ruling sends to the
service layer. A schema also cannot see who is calling, and two of the three rules depend on that.

## How

- `apps/garage/api/src/reservations/reservation-policy.ts` — `assertBusinessDay`, called from
  `assertMayTakeDay` **before** the window check, so a Saturday in a locked month is reported as
  the Saturday. That is the fact that will still be true next month.
- `isBusinessDay` from `@garage/shared-types` is the only implementation of "business day";
  nothing here re-derives it.
- `reservation-policy.spec.ts` covers the ordering and the admin case; `reservations.db.spec.ts`
  and `waitlist.db.spec.ts` cover it end to end.

## Risk

**A client switching on `code` alone cannot tell a holiday from another rule violation.** Accepted:
the Czech copy is written to cover both, and `details.reason` is there for a client that needs
more. If a future screen needs to branch on it in the UI, promoting it to its own code is an
additive change and this record is where that conversation starts.

**`VALIDATION_FAILED` is a 400 while the other day-eligibility codes are 422/423.** Mildly
inconsistent. Not worth a contract change on its own; the frontend keys off `code`, not status.
