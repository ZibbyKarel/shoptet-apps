# 0297 – The ESM `transformIgnorePatterns` block lives in `jest.preset.js`

**Date:** 2026-09-03 · **Status:** accepted · **Task:** final-review fix round (libs-wrappers,
M-9) · **Follows on from:** `doc/decision/0020-*`

## What

`jest.preset.js` now sets

```js
transformIgnorePatterns: [`/node_modules/(?!(?:${ESM_ONLY_PACKAGES.join('|')})/)`]
```

from a single `ESM_ONLY_PACKAGES` list — the **union** across the workspace: `@orpc`, plus
next-intl and its message-formatting dependencies (`use-intl`, `intl-messageformat`, `@formatjs`,
`@schummar`, `icu-minify`).

Four project configs dropped their own copy: `libs/shared/api-client`, `libs/query`, `libs/shared/i18n`,
`libs/garage/calendar-export`.

## Why now, and why it took eleven copies

`doc/decision/0020-*` said the third project to need this block should move it into
`jest.preset.js` instead of copying it again. Every project that added a copy said so, honestly,
in its own comment — and then copied it anyway, for the same reason each time: consolidating
touches the workspace root and other projects' files, and each task's file set was one lib. The
count in `libs/garage/calendar-export/jest.config.cts` said seven; the final review said eight; it was
**eleven** by the time anyone counted with a grep. That is what an instruction nobody is
positioned to carry out looks like after a few tasks.

This fix round owns four of them and the root, which is enough to do the shared half.

## What did **not** move, and why

Per-project, because they genuinely differ:

- **the `'^.+\\.mjs$'` `transform` entry.** `libs/shared/api-client` and `libs/garage/calendar-export` run
  ts-jest; `libs/query` and `libs/shared/i18n` run babel-jest. The entries are not interchangeable.
- **`'mjs'` in `moduleFileExtensions`.** Without it resolution never finds the files, so
  `transformIgnorePatterns` has nothing to act on. It is also absent from the React projects that
  do not need it (`libs/shared/form`, `libs/garage/realtime-client`), and adding it globally would change
  resolution order for every project.

## Why the union rather than a per-project list

`transformIgnorePatterns` only says a file *may* be transformed **if it is loaded**. A project
that never imports `next-intl` is unaffected by `next-intl` appearing in the pattern. Verified:
`libs/shared/form` and `libs/garage/realtime-client` had no block at all and now inherit this one; both still
pass, because nothing on their runtime paths is ESM-only (`libs/garage/realtime-client`'s config explains
why in detail, and that reasoning is unchanged).

A per-project list would have meant a helper module, a second root file, and every project
overriding the preset — which is how eleven copies started.

## The copies that remain, and who owns them

Seven, all outside this task's file set:

| file | note |
| --- | --- |
| `apps/garage/web/jest.config.cts` | **Cannot be consolidated.** Its config goes through `next/jest`, which *always writes* `transformIgnorePatterns` (`next/dist/build/jest/jest.js:197-210`, verified on Next 16.1.7) — so the preset's value never reaches the resolved config, because Jest only falls back to a preset for a key the project leaves unset. Anything passed to `createJestConfig` is **appended** after Next's own entries, and since `transformIgnorePatterns` is a union, appending an exemption after a broader match does nothing. That file's own comment measures both paths. A permanent exception, not a to-do. |
| `apps/garage/api/jest.config.cts` | consolidatable |
| `apps/garage/api/jest.database.config.cts` | consolidatable |
| `libs/garage/contract/jest.config.cts` | consolidatable |
| `libs/garage/database/jest.config.cts` | consolidatable |
| `libs/garage/auth/jest.config.cts` | consolidatable |
| `libs/shared/design-system/compounds/jest.config.cts` | consolidatable |

Each of those still works: Jest merges a preset **shallowly**, so a project that sets
`transformIgnorePatterns` replaces the preset's value with its own, and each of these six sets one
equivalent to or narrower than the union. Deleting the line from any of them is a one-line change
that needs no other edit. **The count in `doc/decision/0020-*` should be corrected to say four
consolidated, six outstanding, one permanently exempt** — that record is shared ground and was not
in this task's edit set.

## How it is verified

`npx nx run-many -t test --skip-nx-cache` — 15 projects, 49 suites, 702 tests, exit 0.

Falsified by removing `transformIgnorePatterns` from `jest.preset.js` and re-running the four
consolidated projects: **all four fail**, with `SyntaxError: Cannot use import statement outside a
module` — `query` 3 suites, `i18n` 4, `api-client` 2, `calendar-export` 1. So the preset's value is
what those projects are now running on, not a leftover local copy.
