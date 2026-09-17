# 0025 – `next-intl` is ESM-only; Jest in `libs/shared/i18n` must also transpile `@orpc`

**Date:** 2026-08-28 · **Status:** accepted · **Affects:** `libs/shared/i18n/jest.config.cts`

## What

`libs/shared/i18n` runs into two independent ESM-only libraries in the same project,
both in the shape described in
`doc/decision/0020-orpc-is-esm-only-jest-must-transpile-it.md`:

1. `next-intl` and its transitive dependencies (`use-intl`,
   `intl-messageformat`, `@formatjs/*`, `@schummar/icu-type-parser`,
   `icu-minify`) — published as `"type": "module"`, plain `.js`.
2. `@orpc/contract` (a single `.mjs` build) — pulled in transitively, because
   `errors.spec.ts` imports `ERROR_CODES` from `@garage/contract` **at
   runtime** (not just as a type).

Without intervention, Jest fails with
`SyntaxError: Cannot use import statement outside a module`.

## Why

`libs/shared/i18n` is a React lib (generator `@nx/react:lib`), so unlike
`libs/garage/contract` it doesn't transpile via `ts-jest`, but via `babel-jest`
(`@nx/react/babel`). The fix therefore differs from `doc/decision/0020-*` in
three ways, not just a copy:

- **`transformIgnorePatterns`** must allow both groups of packages at once
  (`@orpc|next-intl|use-intl|intl-messageformat|@formatjs|@schummar|icu-minify`),
  not just one.
- **`.mjs` must go through `babel-jest`**, not `ts-jest` — `libs/shared/i18n` doesn't
  use `ts-jest` at all.
- **The order of keys in `transform` matters.** The `@nx/react:lib` generator
  puts the pattern `'^(?!.*\\.(js|jsx|ts|tsx|css|json)$)'` first (Nx's asset
  transform for images/CSS). Jest applies the first pattern that matches a
  file — and `.mjs` *matches* this negation (because `mjs` wasn't in the
  extension list), so `.mjs` files silently ended up in the asset transform
  instead of babel, and the `import` passed through unmodified. The fix is to
  add `mjs` to that negation, not to add another rule after it — a new rule
  placed after an existing match would never be reached.

A second, separate problem: the `@garage/contract` barrel (`src/index.ts`)
also re-exports `src/api`, which at runtime imports `@orpc/client` (for the
oRPC procedure builder). That in turn references the web `TransformStream`,
which jsdom (the default test environment for `libs/shared/i18n`, needed for
`provider.spec.tsx`, which renders React) doesn't provide. The fix isn't a
polyfill, but `/** @jest-environment node */` on `errors.spec.ts` — that file
never touches the DOM, so it runs in plain Node, where `TransformStream` has
been global since Node 18.

## How

- `libs/shared/i18n/jest.config.cts`: `transformIgnorePatterns` lists both package
  groups, `.mjs` is added to `transform` (routed to `babel-jest`) and to
  `moduleFileExtensions`, and `mjs` is added to the negation of the first
  (asset) rule.
- `libs/shared/i18n/src/lib/errors.spec.ts`: the pragma comment
  `@jest-environment node`.
- `doc/decision/0020-*` itself says that once this fix is needed a third time,
  it belongs in the root `jest.preset.js` instead of being copied — but Task
  17 is only allowed to touch `libs/shared/i18n/**`, so it stays local for now.
  Whoever eventually unifies it should unify both copies (`libs/garage/contract` and
  `libs/shared/i18n`) at once.

## Risk if this is wrong

The duplication risk is the same as in `doc/decision/0020-*`: the copies can
drift apart. A risk specific to `libs/shared/i18n` is that ordering in `transform` —
if someone added another `'^.+\\.mjs$'` rule without fixing the negation in
the first pattern, the fix would silently stop working again. Both
`dates.spec.ts` and `errors.spec.ts` would fail immediately in that case
(importing `next-intl` and `@garage/contract` respectively is required by
both), so the regression wouldn't go unnoticed.
