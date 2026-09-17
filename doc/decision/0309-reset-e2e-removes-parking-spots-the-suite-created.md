# 0309 – `reset-e2e` removes parking spots the suite created

## What

`libs/garage/database/src/scripts/reset-e2e.ts` deletes every `ParkingSpot` whose
label is not one of the nine in `SEED_PARKING_SPOTS`, together with any
reservation or queue entry on it, before it clears the target month.

Its contract therefore now has three clauses, not two: it empties the e2e
target month, it removes non-seeded spots, and it widens the reservation
window. It still touches no seeded spot, no user and no role — `prisma db
seed` owns those, and `globalSetup` runs it first.

## Why

`apps/garage/web-e2e/src/admin-spots.spec.ts` exercises spot administration, and the
only honest way to test "an admin adds a bay and it appears on the lot" is to
add one. The spec removes it again, but a spec's teardown is exactly the thing
that does not run when the spec fails halfway, or when somebody presses
Ctrl-C.

Nothing else would ever remove it. `libs/garage/database/src/scripts/seed.ts` is
idempotent *by upsert on the natural key*:

```ts
await prisma.parkingSpot.upsert({ where: { label }, … })
```

which restores the nine seeded rows and is silent about a tenth. So a leftover
spot is **permanent** — not until the next run, but until somebody notices it
in adminer months later. Every run after the accident would then start in a
different world than the one its author measured: a lot with an extra bay, an
extra row in two admin tables, an extra `<option>` in every holder selector,
and an occupancy count one higher than the number in whichever assertion
eventually starts failing.

That is the same class of problem as the leaked `next start` in
`0285-*`: a test suite whose state depends on how the *previous* run ended.
The fix is the same shape too — state the precondition where it cannot be
skipped, rather than hoping a teardown ran.

Measured, against the dev database:

```
psql … 'select count(*) from "ParkingSpot"'            → 9
INSERT INTO "ParkingSpot" … 'E2E.ZZ'                   → INSERT 0 1
npx nx run database:reset-e2e
  → Removed 1 non-seeded parking spot(s) left over from an earlier run,
    with 0 reservation(s) and 0 queue entrie(s) on them.
psql … 'select count(*) from "ParkingSpot"'            → 9
```

## Why in this script and not in a spec's `afterAll`

Both, in fact — the spec cleans up after itself, and tolerates a leftover on
the way in. But the guarantee belongs here for the reason the month sweep does:
this script's job is to say what is true before the first browser opens, and
that has to hold however the previous run ended. A teardown cannot make a
promise about a run that was killed.

## Why deleting is safe here

`assertDisposableDatabase` runs first and reads the connection string, so the
only databases this can reach without an explicit
`GARAGE_ALLOW_DESTRUCTIVE_RESET=1` are local, disposable ones
(`0276-*`). A developer's own reservations on other months survive — the month
sweep is still scoped — and a developer's own *hand-created spot* does not,
which is a new and stated cost of running this script. It is the same trade the
un-restored reservation window already makes, and for the same reason.

## The order of the deletes is load-bearing

`Reservation.parkingSpotId` and `WaitlistEntry.parkingSpotId` are
`onDelete: Restrict` (`libs/garage/database/prisma/schema.prisma`), so the spot cannot
go first: PostgreSQL would refuse the delete rather than cascade it. Rows on
the stray spot are removed, then the spot. The counts are reported separately,
because "removed a spot that had reservations on it" is a different sentence
from "removed an empty spot" and a reader of the log should be able to tell
which happened.
