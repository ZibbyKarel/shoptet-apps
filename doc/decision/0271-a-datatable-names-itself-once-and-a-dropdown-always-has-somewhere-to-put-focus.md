# 0271 – A DataTable names itself once, and a Dropdown always has somewhere to put focus

Two small accessibility fixes in the same round, recorded together because
neither is large enough to stand alone and both are "the markup was reasonable
and the announced result was not".

## What

- **`DataTable` (compounds).** The card `<section>` carried `aria-label={title}`.
  It has been removed. The table's `sr-only <caption>` and the visible heading
  stay.
- **`Dropdown` (primitives).** A menu whose every item is `disabled` opened onto
  nothing. The focus effect now falls back to focusing the panel itself, which
  carries `tabIndex={-1}`.

## Why

**DataTable.** A `<section>` becomes a `region` landmark the moment it has an
accessible name, so every table announced its title three times: once as a
landmark, once as the table's caption, once as the visible heading. Three admin
screens each render one, so a screen-reader user walking the landmarks of the
admin area met three same-named regions that added nothing — the caption already
names the table, which is the thing being read. The caption is the one that has
to stay: it is what makes `getByRole('table', { name })` resolve, and it is
attached to the element a screen reader is actually navigating.

Checked before removing: nothing in `apps/garage/web`, `apps/garage/web-e2e` or any spec
queries a `region` by a DataTable title. The three `getByRole('region', { name:
'Skupina IT' })` assertions in `apps/garage/web-e2e/src/login.spec.ts` resolve to
`lot-grid.tsx`'s own `<section aria-label>`, which is untouched.

**Dropdown.** `openAt` falls back to `enabledIndexes[0] ?? 0`, and the focus
effect then called `.focus()` on that index. `.focus()` on a `disabled` button
is a silent no-op, so with every item disabled the panel opened,
`aria-expanded` became `"true"`, and focus stayed on the trigger *behind* it.
A keyboard user had opened something they could not reach, and Escape — which
the layer set delivers to the layer the keyboard is in — would not be delivered
to the menu either. Focusing the panel keeps the menu announced, keeps Escape
working, and returns focus to the trigger on close like every other path.

## How

- `libs/shared/design-system/compounds/src/lib/data-table/data-table.tsx`: `aria-label` removed,
  and the comment that used to justify it now says why the section is
  deliberately unnamed. `data-table.spec.tsx` asserts
  `queryByRole('region')` finds nothing while `getByRole('table', { name })`
  still resolves. Re-adding the attribute fails it.
- `libs/shared/design-system/primitives/src/lib/dropdown/dropdown.tsx`: the focus effect checks
  `item && !item.disabled` before focusing it and falls through to
  `menuRef.current?.focus()`. `tabIndex={-1}` keeps the panel out of the tab
  order, so the menu is still one stop. Three tests in `dropdown.spec.tsx`
  cover it — focus lands on the panel and not the trigger, Escape still closes
  and returns focus, and the panel adds no tab stop. Reverting the effect fails
  the first.

## Risk

- **The DataTable card is no longer a landmark**, so a screen-reader user cannot
  jump to it by landmark. Jumping by *table* still works and is the more useful
  navigation for a table anyway. If a future screen has one table among a lot of
  other content and genuinely wants a landmark, the right fix is a named
  landmark on the screen, not one per table inside the compound.
- **Focusing a `role="menu"` container is a fallback, not the ARIA pattern.**
  The pattern is roving tabindex over `menuitem`s, which is what happens in
  every other case; this only fires when there is no `menuitem` to land on. The
  alternative — refusing to open at all — gives the user no feedback that they
  pressed anything, which is worse.
