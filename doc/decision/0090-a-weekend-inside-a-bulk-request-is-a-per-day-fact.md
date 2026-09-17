# 0090 – A weekend inside a bulk request is a per-day fact, not a rejected request

**Date:** 2026-09-02 · **Status:** accepted · **Affects:** `apps/garage/api/src/reservations/bulk-*`
**Follows on from:** `doc/decision/0064-*`

## What

`reservation.previewBulk` and `reservation.confirmBulk` answer **`UNAVAILABLE /
NOT_A_BUSINESS_DAY`** for a weekend or a Czech public holiday inside the selection, and carry on
with the rest of the batch. They do **not** reject the request.

Only two conditions fail a whole bulk request:

| Condition | Outcome |
| --- | --- |
| any selected day is in the past | `PAST_DATE` |
| the target month is not open for this caller | `RESERVATIONS_LOCKED` |
| the batch is empty, or spans two calendar months | `VALIDATION_FAILED` |
| a selected day is a weekend or a holiday | **not an error** — that day is `UNAVAILABLE` |
| the user already holds a reservation that day | **not an error** — that day is `UNAVAILABLE` |
| there are no active spots at all | **not an error** — that day is `UNAVAILABLE` |

This is a deliberate deviation from Task 30's brief, which said weekends and holidays are
"rejected already by input validation".

## Why

**The contract had already decided, and the contract is the source of truth.**
`BULK_UNAVAILABLE_REASONS` (Task 4, `libs/garage/shared-types/src/lib/domain-constants.ts`) lists
`NOT_A_BUSINESS_DAY` as one of exactly three per-day reasons, above a doc comment that states the
rule in so many words: *"These are per-day facts reported inside a successful response, not errors:
one impossible day must not throw away the rest of the batch. Conditions that invalidate the whole
request (locked month, day in the past) are contract errors on the procedure instead."* Rejecting
the request would have left a contract member with no reachable trigger, which
`doc/decision/0021-*` forbids outright.

**Nothing in the input schema can enforce it anyway.** `bulkBookingInputSchema` is a Zod schema; the
Czech public-holiday calendar lives in `@garage/shared-types` and depends on the year. Zod
*could* call `isBusinessDay` in a `refine`, but then the first Saturday in a 20-day selection would
throw away the other 19 days' answers — which is exactly the failure mode the contract's comment
was written against.

**It is what the screen needs.** The bulk month grid shows every selected day with what will happen
to it. "Your request is invalid" is not something it can render per cell; `UNAVAILABLE /
NOT_A_BUSINESS_DAY` is. The user picked a range and the range contains weekends — that is normal
use, not a malformed request.

**It does not weaken the single-day rule.** `reservation.create` and `waitlist.join` still refuse a
weekend outright with `VALIDATION_FAILED` (`doc/decision/0064-*`). Both paths derive the fact from
the same `isBusinessDay`; they differ only in whether one bad day is allowed to sink the others,
and only the bulk path has others.

## How

- `bulk-allocator.ts` — `planDay` checks `isBusinessDay` **first**, before the "already booked" and
  "no spots" branches, for the reason given in `doc/decision/0064-*`: a Saturday is the most durable
  fact about a day and should be the one reported.
- `bulk-reservation.service.ts` — `assertRequestable` runs only `assertNotInThePast` and
  `assertWindowOpen`, deliberately **not** `assertMayTakeDay` (which would add the business-day
  throw). The asymmetry is commented at the call site.
- `bulk-allocator.spec.ts` covers the ordering against a holiday, a weekend and a business day;
  `bulk-reservation.db.spec.ts` ("marks a weekend and a holiday unavailable without discarding the
  rest") covers it end to end.

## Risk

**A client that trusted the brief would expect a 4xx for a weekend and will instead get a 200 with
an `UNAVAILABLE` day.** This is the safer direction — extra information rather than a failed
request — and the contract's own types have said so since Task 4, so no shipped client can have
been written to the other reading.

**Two behaviours for one rule.** A weekend is fatal to `reservation.create` and merely a fact to
`confirmBulk`. Justified above, but it is a thing to remember: the two procedures are not
interchangeable, and a future "book one day" that goes through the bulk service would quietly stop
refusing weekends. The single-day path is not built on the bulk one, and should not be.
