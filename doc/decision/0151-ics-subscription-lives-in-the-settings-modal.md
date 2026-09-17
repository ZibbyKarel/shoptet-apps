# 0151 – The ICS subscription section lives inside the settings modal

## What

`doc/design/screens/11-settings.png` shows only the licence-plate and
preferred-spot form. `plan.md` separately requires that the caller be able to
see their ICS calendar-subscription URL, copy it, and regenerate the token
behind a confirmation. `apps/garage/web/src/shell/settings-screen/settings-screen.tsx` adds this as a
second `<section>` inside the *same* `Modal`, below the form and above the
footer, rather than as its own route or its own dialog.

## Why

- **It is caller-scoped settings, not a feature with its own workflow.** The
  ICS feed is a personal credential — `icsToken` on the user entity
  (`libs/garage/contract/src/schemas/entities.ts`'s `userSchema`, re-exported as part
  of `myProfileSchema` in `libs/garage/contract/src/api/me.ts`; `libs/garage/contract/src/api/ics.ts`
  only defines the URL-building helpers, not the field itself) — exactly like
  the licence plate and preferred spot are personal preferences — all three
  are read from and written back to the same `me.*`
  endpoints (`me.get`, `me.updateSettings`, `me.regenerateIcsToken`). Giving
  it a separate screen would split one "about me" concept across two places
  in the navigation for no functional reason.
- **The design's visual language extends cleanly.** The section reuses the
  same `Input`/`Button`/`Toast` primitives and the same spacing rhythm as the
  form above it (a `border-t` divider, a heading, a description, a control
  row) — see the `IcsSection` component. Nothing about the section needed
  its own layout to look native next to the design's part of the screen.
- **Regeneration is destructive and irreversible** (the old URL stops
  resolving), which is exactly what `ConfirmDialog` exists for
  (`doc/decision/0071-*`). Reusing it here — rather than inventing a second
  confirmation pattern — keeps "irreversible action → `ConfirmDialog`" a rule
  with no exceptions in this codebase.
- **One save action, one place to look for it.** If the ICS section lived on
  its own route, a caller editing their licence plate would have no way to
  know a calendar link exists at all unless they went looking elsewhere.
  Placing it in the same modal means anyone who opens "Nastavení" sees
  everything they can configure about themselves in one pass, matching what
  the word "Nastavení" (settings) implies.

## How

- The `ConfirmDialog` for regeneration is rendered as a sibling of `Modal`
  (both returned from `SettingsScreen`), not nested inside its JSX children.
  **Correction (Task 26 review, M7): the primitives support nesting a second
  focus trap perfectly well** — `DismissableLayerProvider` carries the parent
  link through React context (which crosses a portal boundary even though the
  DOM node itself moves to `document.body`), and `useFocusTrap`'s
  `isActiveFocusTrap` check pauses the outer trap the moment an inner one
  opens and resumes it when the inner one closes (`doc/decision/0056-*`
  documents the whole layer tree). Nothing here would "fight" over `Tab`
  either way. The reason `ConfirmDialog` is a sibling rather than a JSX child
  is simpler: `SettingsScreen` renders it unconditionally (`open={confirmOpen}`
  gates whether it draws anything), so it needs a stable place to live outside
  the `ready`-gated form content — nesting it *inside* `Modal`'s children would
  have worked exactly as well for focus, and was not the deciding factor.
  Measured either way: Tab cycles `Zrušit → Vygenerovat → Zavřít` strictly
  inside the confirm dialog, and Escape closes only the confirm dialog, leaving
  the settings modal open underneath it.
- The section degrades independently of the form: if `apiOrigin` cannot be
  derived (`app/(app)/settings/page.tsx`'s fallback to `''`) or the profile
  has not delivered an `icsToken` yet, `IcsSection` shows `icsUnavailable`
  copy instead of a broken link — it does not block the licence-plate/spot
  form above it from working.
- Copying the link and regenerating the token are independent of the
  Cancel/Uložit footer: both act immediately (`handleCopy`,
  `handleConfirmRegenerate`) rather than being staged into the form's submit,
  because neither one is "settings you are drafting" — a copy has no server
  effect, and a regenerated token is already committed the moment
  `me.regenerateIcsToken` returns.
- The token itself is never logged: `handleCopy`'s `catch` only sets
  `copyState('failed')`, and `SettingsPage`'s mutation error handling never
  serialises the mutation's variables or result — see the ICS token's prior
  logged-in-four-places defect this task was warned about, which lived on the
  server side (`apps/garage/api/src/me/`) and predates this change; no client-side
  logging call was added here at all.

## Risk

- **The ICS strings have no design to match.** `icsHeading`, `icsDescription`
  and the rest of `CzechSettingsMessages`'s ICS keys are original copy,
  written in the same register as the shell's existing `errorUnknown`/
  `comingSoon` sentences rather than lifted from a mock. If a designer later
  produces a real mock for this section, its copy should replace these
  strings rather than the other way around.
- **Two dialogs stacked on one route** (the settings `Modal` and, on top of
  it, the regenerate `ConfirmDialog`) is a screen shape no other route in this
  app currently uses. It works because the two never need focus at the same
  time, but it is a pattern worth watching if a future screen tries to nest a
  third.
