# 0268 – The spacing scale stays open, the enumeration stays, and the comment that claimed otherwise is gone

## What

`assets/theme.css` enumerates thirteen `--spacing-N: var(--space-N)` keys and
justified them like this:

> Named per-key (not the single `--spacing` base unit) because the source scale
> skips numbers (no 7, 9, 11, ...) and isn't a clean multiplier table Tailwind
> could derive on its own.

Both halves are false, and the final review proved it by compiling the file.
The enumeration is kept — for a different, real reason — and the comment now
says what actually happens. The scale is **not** closed.

## Why

Three facts, each measured by compiling `theme.css` through the repo's own
`tailwindcss@4.3.3` and reading the emitted rules.

- **The scale was never closed, and every "skipped" number still works.**
  Tailwind v4's default `--spacing: 0.25rem` multiplier is in place, because
  nothing ever reset it. `.p-7 { padding: calc(var(--spacing) * 7) }`,
  `.w-70`, `.max-w-96`, `.min-h-80` all compile. The design system's own stories
  already spend that escape hatch fourteen times.
- **Every enumerated key is exactly N × 4px.** `--space-1: 4px` … `--space-32:
  128px`. It *is* a clean multiplier table. The stated reason for enumerating
  was never true.
- **But the enumeration is not a no-op, which is the part nobody had checked.**
  Compiled with the thirteen lines deleted, `.p-4` becomes
  `calc(var(--spacing) * 4)` instead of `var(--space-4)`. Deleting them would
  make every `--space-*` token dead — nothing would consume them — and would
  move the whole scale from the px the design specifies to rem. So the
  enumeration is what binds the utilities to the token file. That is worth
  having; it is just not what the comment said.

**Closing the scale was the other option offered, and it is worse than it
sounds.** Compiled with `--spacing-*: initial` added, against the whole
repository's sources, the emitted stylesheet loses eighteen selectors:

```
.p-0  .m-0  .inset-0  .top-0  .right-0  .bottom-0  .left-0
.mt-0\.5  .h-9  .h-11  .w-70  .w-80  .sm\:w-80
.max-w-96  .min-h-40  .min-h-64  .min-h-80  .min-h-96
```

- **It does not fail loudly. It fails silently.** Tailwind emits nothing for an
  unknown spacing key and reports nothing — no warning, no error, no non-zero
  exit. A closed scale would turn "someone wrote an off-scale class" from a
  visible pixel value into an invisible missing rule.
- **It takes the zero-value utilities with it.** `p-0`, `m-0` and every
  `inset-0`/`top-0`/`left-0` resolve through the same multiplier, and nothing in
  the token scale defines a `0` step. `radio.tsx` alone uses `border-0 p-0`.
- **Four of the eighteen are in `apps/garage/web`** (`lot-header.tsx`,
  `admin-users-screen.tsx`, `admin-window-screen.tsx`, `lock-mode-choice.tsx`),
  which this change does not own and cannot fix in the same commit. Closing the
  scale would have shipped a silent layout regression in three admin screens.

## How

- `libs/shared/design-system/tokens/assets/theme.css` — the spacing comment is
  replaced with what the compiler actually does, and the file header now names
  the test that guards it.
- `libs/shared/design-system/tokens/src/lib/theme-css.spec.ts` compiles the real file
  with the real Tailwind and asserts both halves, so neither claim can go stale
  again:
  - every key in `SPACING` emits `padding: var(--space-N)`;
  - `p-7`, `w-70`, `max-w-96`, `min-h-80` still emit
    `calc(var(--spacing) * N)` — the scale is open, on purpose, and the test
    says so.
- The fourteen off-scale story usages are left alone. They are story-canvas
  sizing (`max-w-96` around a form, `min-h-80` to give a dropdown room to open),
  not product spacing, and with the scale open by design they are not
  violations.

## Risk

- **A token layer that is documented as open is still open.** Nothing stops
  someone writing `p-7` in a component. What has changed is that the file no
  longer *claims* to stop them, and a reader can no longer be misled into
  thinking the token scale is enforced when it is not. Enforcing it would need a
  lint rule over class strings — with `p-0`, `gap-px`, `w-1/2` and `top-full` all
  to special-case — and that is a bigger change than this round should make.
- **The px-vs-rem consequence is now load-bearing.** Because the enumeration
  stays, spacing does not scale with a user's browser font size. That matches
  the design, which specifies px, but it is a real accessibility trade and it is
  now written down rather than accidental.
