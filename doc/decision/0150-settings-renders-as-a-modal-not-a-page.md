# 0150 – `/settings` renders as a `Modal`, not a bespoke dialog shell

## What

`apps/garage/web/src/shell/settings-screen/settings-screen.tsx` renders the whole settings screen —
licence plate, preferred spot, and the ICS section (`doc/decision/0151-*`) —
inside the design system's `Modal` primitive
(`libs/shared/design-system/primitives/src/lib/modal/modal.tsx`), reached at the
`/settings` route. Closing it (Cancel, Escape, or a successful save) pushes
back to `LOT_ROUTE` (`/`), so the "page" is really an overlay on top of the
parking overview. There is deliberately no × and no scrim-click-to-close — see
the fix-round note at the end of "How".

## Why

- **`doc/design/screens/11-settings.png` already draws it as a dialog** — a
  centered card with a title, a description, a form, and a
  Cancel/Uložit footer over a dimmed background — which is exactly `Modal`'s
  shape (`title` / `description` / `footer` / `size` props). Building a second,
  hand-rolled dialog shell to reproduce that would duplicate a primitive the
  design system already ships, for no visual difference.
- **`Modal` already carries the accessibility work this screen needs**: a
  portal to `document.body`, a focus trap, and `Escape`-to-close. Settings has
  no requirement that would justify reimplementing any of that. (It opts out
  of two of `Modal`'s *defaults* — the × button and scrim-click-to-close — see
  the fix-round note under "How".)
- **The route still exists on purpose.** `/settings` is a real, linkable,
  reloadable URL — the avatar menu's "Nastavení" item and a direct paste of
  the link both work — even though what it renders is an overlay. This mirrors
  how the design presents it: something you open from the top bar, on top of
  wherever you already were, not a screen you navigate into and lose your
  place.
- **Primitives and compounds stay presentation-only** (root `CLAUDE.md`,
  design-system-first rule): `Modal` knows nothing about the profile, the
  form, or oRPC. All of that domain wiring lives in `SettingsScreen` (tested
  with plain props) and `SettingsPage` (untested wiring), which is exactly the
  split `AdminScreen`/`admin/page.tsx` and `TopBar`/`AppTopBar` already use
  elsewhere in this codebase.

## How

- `SettingsScreen` always renders `<Modal open onClose={onClose} ...>` —
  there is no "closed" state to model, because the only way to be looking at
  this component at all is via the `/settings` route.
- The footer is `undefined` while the profile is still loading or failed to
  load (`ready = !isPending && !isError && profile !== undefined`), so the
  Cancel/Save buttons cannot appear over a form that has not been seeded yet —
  `ScreenLoading`/`ScreenError` render as the modal's children instead, reusing
  the same components every other screen's loading/error states use.
- `onClose` is one callback, invoked identically by every exit path `Modal`
  itself recognises, plus a successful save (`SettingsPage`'s
  `updateSettings` mutation calls `router.push(LOT_ROUTE)` from its
  `onSuccess`). There is no separate "did the form change" confirmation on
  close — Cancel discards silently, matching the design, which shows no
  "unsaved changes" affordance.
- **Fix round 1 (Task 26 review, M3/M5): `closeOnScrimClick={false}` and
  `hideCloseButton`.** Two gaps the initial review found, both now closed
  together because they share one cause. `Modal`'s own prop docs call out
  `closeOnScrimClick={false}` by name for "a dialog with unsaved input, where
  a stray click should not throw work away" — this screen is exactly that, and
  leaving the default `true` meant one misplaced click on the backdrop
  silently discarded an in-progress edit and navigated away. `hideCloseButton`
  is the design fidelity fix (`11-settings.png` draws no ×), but it also
  repairs an accessibility regression the × caused as a side effect: with it
  present, it was the first tabbable element in the dialog, so the modal
  opened with focus on a close affordance instead of on the SPZ field.
  Removing it lets focus land on the first real control once the form is
  ready (`useFocusTrap` focuses the first tabbable element in DOM order), and
  falls back to `ScreenLoading`'s/`ScreenError`'s own controls while it is
  not. The remaining ways out — Cancel and Escape — are unaffected by either
  change.

## Risk

- **A modal-shaped route cannot deep-link to a sub-state** (e.g. "settings,
  scrolled to the ICS section") without a query string this implementation
  does not add. Not needed today: the screen is short enough to see both
  sections without scrolling on the design's target viewport.
- **Closing on save is not undoable.** If `updateSettings` succeeds but the
  user meant to keep editing, they must reopen `/settings` and start again.
  This matches the "Uložit" button's implied contract (save closes) and the
  design has no separate "save and keep open" affordance to preserve instead.
