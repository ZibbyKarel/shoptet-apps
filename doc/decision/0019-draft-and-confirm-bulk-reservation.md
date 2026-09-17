# 0019 – The bulk-reservation preview and confirmation share a shape; the client computes the diff

**Date:** 2026-08-28 · **Status:** accepted · **Follows on from:** `doc/decision/0004-*` §Bulk reservation

## What

`previewBulk` and `confirmBulk` take **the same input** (`{ dates: DateOnly[] }`)
and return **identically shaped output**: an array `days`, where each day is a
discriminated union

```
SPOT_ASSIGNED { date, parkingSpotId, parkingSpotLabel, isPreferredSpot }
QUEUED        { date, parkingSpotId, parkingSpotLabel, waitlistPosition }
UNAVAILABLE   { date, reason }
```

The result of `confirmBulk` additionally carries the id of the written row
(`reservationId`, or `waitlistEntryId`). Every variant of the result is
therefore a **superset** of the corresponding preview variant.

**The frontend computes the diff between preview and reality** by pairing both
arrays up by `date`. The server does not compute it, because it cannot — see
below.

In addition:

- **Errors vs. per-day results.** Things that invalidate the whole request (a
  locked window, a day in the past) are declared procedure errors. Things that
  concern a single day (`ALREADY_HAS_RESERVATION`, `NOT_A_BUSINESS_DAY`,
  `NO_SPOTS_AVAILABLE`) are `UNAVAILABLE` inside a **successful** response. One
  impossible day must not discard the rest of the batch.
- **`previewBulk` declares the same window errors as `confirmBulk`.** Proposing
  a schedule for a month the user isn't allowed to book means showing them a
  plan they can never confirm.
- **The input schema validates only structure**: a non-empty list, at most 31
  days, no duplicates, all days in a single month. It does **not** validate
  weekends, holidays, or the past.

## Why

**Why the server doesn't compute the diff.** To do that, `confirmBulk` would
need to see the proposal the user approved. But the brief says "input: the
same list of days", and rightly so: if the client sent the plan back, the
server would either have to trust it (opening the door to slipping in someone
else's spot), or recompute it anyway (making the round trip pointless).
Recomputing inside the transaction doesn't help either — the difference arises
**between** the preview and the confirmation, not inside the write itself.

The client, meanwhile, already holds the proposal: it just showed it to the
user. Pairing by `date` is a few lines, and it has the data for it. The
contract, therefore, isn't meant to compute the diff — it's meant to make the
diff **computable** — and it does that by giving both responses an identical
structure and the same key.

**Why the diff is still legible without the proposal.** The user might have
refreshed the page in the meantime. Even so, the result alone says enough:
`QUEUED` means "you didn't get a spot", `isPreferredSpot: false` means "you
didn't get your own". The summary (`assigned` / `queued` / `unavailable` /
`preferredSpotHits`) gives the modal a title without any comparison at all.

**Why the schema doesn't validate weekends and holidays.** It's tempting —
`isBusinessDay` is a pure function in `libs/garage/shared-types` and the contract can
see it. But it's **day eligibility**, the same category as "not in the past"
and "inside the open window", which the window ruling already sends down to
the service layer. If one rule out of three lived in the schema, the user
would get `VALIDATION_FAILED` for a holiday and `RESERVATIONS_LOCKED` for a
locked month — two different error categories for one kind of problem.
Moreover, a bug in the holiday table would then block the request before
anyone could add an exception for it. The list's structure (duplicates, single
month, length), by contrast, does belong in the schema: that's a fact about
the list, not about the world.

**Why `UNAVAILABLE` and not an error.** Without it, the allocator would have no
way to describe a day the user already has a reservation on — and the whole
batch would either have to fail, or silently skip that day. Silently skipping
it is worse than either: the user wouldn't know something didn't happen.

## How

- Schemas and both procedures: `libs/garage/contract/src/api/bulk.ts`.
- The enums `BULK_DAY_OUTCOMES` and `BULK_UNAVAILABLE_REASONS`, and the
  constant `MAX_BULK_BOOKING_DAYS`, live in `libs/garage/shared-types` (like every
  domain enum), so `libs/shared/i18n` can also see them for the Czech copy.
- The zip on the frontend (Task 31):

  ```ts
  const byDate = new Map(preview.days.map((day) => [day.date, day]));
  result.days.map((actual) => ({ actual, proposed: byDate.get(actual.date) }));
  ```

- The allocator itself (spot ordering, conflict behavior) is Task 30. The
  contract doesn't prescribe its strategy, only the response shape.

## Risk if this is wrong

If it turns out the server must compute the diff (say, for a "what we
promised" audit), that means **extending `confirmBulk`'s input** with the
proposal and its signature — i.e. a contract change, not just an
implementation change. That's a deliberate deferral: adding a field to the
input is backward compatible, removing one is not.

A smaller risk sits in the `UNAVAILABLE` reasons — there are three, and they
were invented up front. If Task 30 runs into a fourth, it's added as a tuple
entry in `shared-types`, a one-line change that the test on the enum's
composition will show in the diff.
