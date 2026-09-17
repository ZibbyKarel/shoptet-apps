# 0172 – The preferred-spot label has four states, not two

**Date:** 2026-09-03 · **Status:** accepted · **Affects:** `apps/garage/web/src/lot/bulk-modal/bulk-view.ts`

## What

The line under the bulk grid — `Preferované místo: E2.92` in
`doc/design/screens/10-modal-bulk.png` — is produced by `toPreferredSpotView`, which returns one of
**four** things:

| input | rendered |
| --- | --- |
| the profile has not arrived, or the spot list has not | `Preferované místo: načítá se…` |
| `preferredParkingSpotId` is `null` | `Preferované místo: nemáte nastavené` |
| the id is among the active spots | `Preferované místo: <label>` |
| the id is **not** among them | `Preferované místo: už není k dispozici` |

## Why

**The id and the label come from different reads, and only one of them can go stale.** The id is on
the caller's own profile (`me.get`); the label comes from `spot.list`, which returns **active spots
only** ("Deactivated spots are kept for their foreign keys" — `libs/garage/contract/src/api/spots.ts`). An
admin deactivating a spot after somebody chose it as their preference leaves a perfectly valid id
with no label to render.

**A blank is the failure mode, and it is invisible.** `spots.find(...)?.label` returns `undefined`,
React renders nothing, and the line reads `Preferované místo:` — which a user parses as "the app is
still loading" or does not notice at all. Meanwhile the allocator will happily run without a
preferred spot and hand back ordinary assignments, and the user has no way to connect the two. This
is the same defect shape a sibling branch hit on the settings screen, where a stored value absent
from the options it was rendered against let the display and the form state disagree; the settings
screen already carries copy for it (`settings.preferredSpotUnavailable`).

**"Loading" and "not set" are also different, and collapsing them lies in the other direction.**
Showing "nemáte nastavené" while `me.get` is still in flight tells a user with a preference that
they have none, which invites them to go and set one they already have.

**Why the client and not the server.** `previewBulk`'s output does echo
`preferredParkingSpotId` — but only *after* a preview exists, and this line is drawn before the
user has selected a single day. There is no request that could carry it earlier without inventing
one.

## How

- `apps/garage/web/src/lot/bulk-modal/bulk-view.ts` — `toPreferredSpotView(preferredParkingSpotId, spots)`. The two
  `undefined` inputs mean "still loading" and are checked before the `null` that means "no
  preference": `undefined` and `null` are different answers here, which is why
  `exactOptionalPropertyTypes` being on workspace-wide matters.
- `apps/garage/web/src/lot/bulk-modal/bulk-modal.tsx` — `preferredSpotNote()`, a total `switch` over the four kinds.
- `bulk-view.spec.ts` has one test per state, the `unavailable` one named for what it prevents;
  `bulk-modal.spec.tsx` asserts that a retired spot renders the "už není k dispozici" sentence
  **and** that the old label is nowhere on screen.

## Risk

**"Už není k dispozici" is a dead end.** It tells the user the preference is broken but not how to
fix it, and the settings modal is not reachable from inside this one. Acceptable for the MVP — the
bulk booking still works, it simply starts from no preference — but a link would be the obvious
improvement.

**The spot list is fetched only while the modal is open** (`enabled: open`), so the very first open
of the modal always shows "načítá se…" for a moment. That is honest, and the alternative — fetching
the whole lot on page load for a line of text in a modal most sessions never open — is worse.
