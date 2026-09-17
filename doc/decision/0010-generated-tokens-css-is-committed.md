# 0010 – The generated `tokens.css` is committed and excluded from Prettier

**Date:** 2026-08-28 · **Status:** accepted

## What

`libs/shared/design-system/tokens/assets/tokens.css` is a **generated** file (from the TS
tokens in `src/lib/*.ts`, via the `generateTokensCss` function), but it is
**committed to git** and excluded from Prettier formatting via `.prettierignore` —
the same treatment as `apps/garage/web/next-env.d.ts`.

## Why

1. **Committed.** Consumers (the Next.js app, Storybook, tests) get working CSS
   variables right after `npm ci`, with no need to run an extra build step. The
   design system exists only up to Task 6 so far (just `tokens`); `primitives`/
   `compounds` in later tasks will import this file — they shouldn't have to wait on
   someone remembering to run the generator. **Note:** the exact import specifier
   (a relative path vs. some `exports` mapping) isn't resolved yet –
   `@garage/design-system/tokens` is only a TS `tsconfig.paths` alias for module
   resolution; a CSS `@import`/bundler doesn't know it automatically. How
   apps/garage/web/Storybook actually import `theme.css` is up to whichever task first
   consumes this lib — see `doc/design-system.md`.
2. **Excluded from Prettier.** `generateTokensCss` deliberately reproduces the style
   of the source `doc/design/ds/colors_and_type.css` 1:1 — uppercase hex codes
   (`#008FFF`), double quotes, `rgba(35,34,31,0.04)` with no spaces after commas.
   The Task 6 brief explicitly forbids "rounding/renaming/improving" the values.
   Prettier, however, would lowercase the hex codes and add spaces inside `rgba()` —
   changing the notation, even though not the color. Letting Prettier reformat it
   would break the 1:1 match with the source, and worse, would rewrite the file
   differently than `generateTokensCss` produces it after every `npm run format` –
   the drift test (`generate-css.spec.ts`) would then fail even after a harmless
   `format:write`.

## How

- Generator: `libs/shared/design-system/tokens/src/lib/generate-css.ts`
  (`generateTokensCss(tokens: DesignTokens): string`), a pure function with no I/O.
- Runner: `libs/shared/design-system/tokens/scripts/build-tokens-css.ts`, target
  `nx run design-system-tokens:generate-css`.
- Drift test: `generate-css.spec.ts` reads the committed file from disk
  (`fs.readFileSync`) and compares it with `toBe()` against the output of
  `generateTokensCss(DESIGN_TOKENS)` – no Jest inline snapshot, since that would
  silently get rewritten to match the generator's new output and would never catch
  the generator/TS source drifting from the actual file on disk.
- `.prettierignore`: `/libs/shared/design-system/tokens/assets/tokens.css`.
- `theme.css` (the hand-written Tailwind bridge in the same folder), by contrast, **is**
  formatted by Prettier as usual – it's a structural file with `var()` references,
  not a copy of raw values.

## Risk if this is wrong

If the committed generated file turns out to be a problem (e.g. merge conflicts, or
a wish to have the CSS purely derived at build time), the fix is to add
`assets/tokens.css` to `.gitignore` and run `generate-css` as a `preinstall`/
`prebuild` script – no other part of the code depends on the file being committed
except the test, which would be adjusted to regenerate into a tmp file in
`beforeAll`.
