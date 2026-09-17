# 0304 – The reservation holder projection is a discriminated union

**Date:** 2026-09-09 · **Status:** accepted · **Task:** `TODO.md` item 3, Task 2

## What

`publicReservationSchema` (`libs/garage/contract/src/schemas/entities.ts`) no longer
has a `user` key. It now has `holder`, typed by a new export,
`reservationHolderSchema`:

```ts
export type ReservationHolder =
  | {
      readonly kind: "USER";
      readonly userId: string;
      readonly name: string;
      readonly licensePlate: string | null;
    }
  | { readonly kind: "GUEST"; readonly name: string; readonly licensePlate: string | null };
```

`userSummarySchema` is unchanged — `cell:locked`'s `lockedBy` still uses it,
because a lock is always held by a signed-in user, never a guest.

## Why a discriminated union, not a widened `UserSummary`

Task 1 made `Reservation.userId` nullable at the database and contract level,
with `guestName` as the alternative holder. The projection that faces every
consumer had to be widened to match. Two alternatives were rejected:

**Keep `user: UserSummary` and add a parallel `guest: GuestSummary | null`.**
This makes the impossible state representable again at exactly the layer
Task 1 closed it off at: nothing stops both `user` and `guest` being set, or
neither. Every reader would need to re-derive the invariant Task 1's `CHECK`
constraint already enforces, and get it right every time. The whole point of
threading the union through to this layer is to make that check compile-time.

**A single summary with a nullable `id`** — `{ id: string | null; name: string;
licensePlate: string | null }`, `id` set for a user, `null` for a guest. This
was the closer call, because it keeps one object shape instead of two. It
fails the same test the brief's suite encodes directly: "a guest must be
unrepresentable as a user." With a nullable `id`, `holder.id` is _always_
there syntactically — a reader who forgets the `null` check does not get a
compile error, they get `id: null` compared against a real user id at
runtime, which is false by luck rather than by construction — exactly the
class of bug ("a guard that silently no-ops on the null case instead of
failing loudly") a nullable field invites. A discriminated union with
`kind: 'GUEST'` carrying **no** `userId` member turns that mistake into
`Property 'userId' does not exist on type '{ kind: "GUEST"; ... }'` at the
call site, before the code ships.

## Why the field is renamed to `holder`, not left as `user`

A field called `user` cannot honestly carry a guest — the type would be a lie
independent of its shape. Renaming to `holder` was deliberate, not incidental:
it means every reader of the old field breaks loudly at the type checker
(`Property 'user' does not exist on type '{ ...; holder: ...; }'`) rather than
reading `undefined` silently at runtime and rendering nothing, or worse,
throwing only in the one branch a test happened to exercise. Task 2's own
verification found exactly this set of breaks — `apps/garage/api`'s mapper
(`prisma-mapping.ts`, `day-overview.service.ts`) and four call sites in
`apps/garage/web` (`day-overview-cache.ts`, `lot-view.ts`,
`admin-day-screen.tsx`, `admin-spots-panel.tsx`) — which is the intended
outcome for Tasks 3 and 4 to pick up, not a regression to fix here.

## What was measured

`npx nx run contract:test --skip-nx-cache` — 432 passed. `npx nx run
realtime-client:test --skip-nx-cache` — 81 passed. `npx nx run-many -t
typecheck --skip-nx-cache` fails in exactly the two projects downstream of
this change (`api`, `web`), each on the old `.user` access — confirming the
projection change propagates correctly and nothing in `libs/garage/contract` or
`libs/garage/realtime-client` was missed.
