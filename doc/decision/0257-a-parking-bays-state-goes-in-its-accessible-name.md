# 0257 – A parking bay's state goes in its accessible name

## What

The tile `<button>` in `apps/garage/web/src/lot/lot-grid/lot-grid.tsx` labels itself with the
action *and* the state: "Rezervovat místo E2.93, Volné", "Otevřít místo E2.92,
Petr Novák, 8SC 9012", "Otevřít místo E2.93, rezervace uzamčeny", "Otevřít místo
E2.92, právě upravuje Jana Dvořáková". The fragments are the same message keys
the tile draws; no new copy was written.

## Why

- **`aria-label` replaces the button's contents as its accessible name**, and a
  screen reader treats a `<button>` as one node. So everything rendered inside
  the tile — "Volné", the holder's name and licence plate, "rezervace uzamčeny",
  "právě upravuje" and the editor's name — was announced to nobody. A
  screen-reader user heard "Otevřít místo E2.93" for a bay that is taken, one
  that is window-locked and one somebody else is editing, with no way to tell
  them apart. The only state that survived was the waitlist `Badge`, which
  happens to sit outside the button.
- **The suite appeared to cover this and did the opposite.** *"draws an occupied
  bay with the holder and the plate"* asserted `getByText('Petr Novák')` and, on
  the very next line, that the accessible name was `Otevřít místo E2.92` — it
  pinned the holder as present in the DOM while simultaneously pinning that it
  was not in the name. `getByText` passes on DOM presence. Nothing in 537 tests
  asked what was announced.
- **Composed from the keys the tile already draws, not from new ones.** The
  visible text is already the true statement of the state; a second, parallel
  set of strings for screen readers is two catalogues to keep in step, and the
  screen-reader one is the one nobody looks at when the copy changes.
- **Name, not `aria-describedby`.** A description is announced after the name
  and can be turned down or off by verbosity settings; and in a screen reader's
  element list — the buttons-on-this-page view — only the name is shown. For a
  tile whose state *is* the information, the name is where it belongs.
- **The waitlist pill stays out.** It is a sibling of the button, not a child,
  so it already has its own place in the reading order.

## How

- `apps/garage/web/src/lot/lot-grid/lot-grid.tsx` — `accessibleName` is built from the action
  key plus one fragment list per appearance, `null`s and empty strings filtered,
  joined with ", ". The editor case joins with a space, because "právě upravuje
  Jana Dvořáková" is one clause.
- `apps/garage/web/src/lot/lot-grid/lot-grid.spec.tsx` — a new block, *"what a screen reader is
  told about a bay"*, asserts `toHaveAccessibleName` for each of the four
  states, plus a test that renders all four together and pins that no two names
  collide. The pre-existing role queries were updated to the new names.
- `apps/garage/web/src/lot/lot-screen/lot-screen.spec.tsx` — its tile queries were loosened to
  anchored prefix regexes (`/^Otevřít místo E2\.92,/u`). That suite's subject is
  behaviour, not wording; the wording is `lot-grid.spec.tsx`'s.

## Risk

- **`apps/garage/web-e2e/src/support/lot-page.ts` still anchors its selector.**
  `spotTile()` matches `new RegExp('^(Rezervovat|Otevřít) místo ' + label + '$')`,
  and that `$` no longer matches. The file belongs to another shard, so the
  change is **not made here**: the regex needs its `$` relaxed (e.g.
  `^(Rezervovat|Otevřít) místo ${label}(,|$)`), which keeps it from matching the
  `⋯` button ("Možnosti místa X") exactly as before. This is reported rather
  than done, and it is the one thing in this record that is left for somebody
  else.
- **The name is longer.** That is the point; it is also read only on focus, one
  tile at a time.
