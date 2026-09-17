# 0299 – A component and its companions live in one folder

## What

Every component in `apps/garage/web` and `libs/shared/design-system` that has at least one
companion file now lives in its own folder, named after the component:

```
button/button.tsx
button/button.spec.tsx
button/button.stories.tsx
```

**No per-folder `index.ts`** exists or is added. An import names the file it
means — `@garage/design-system/primitives` still resolves through the
lib's own barrel; inside a folder, `./button/button` is written out in full,
never shortened to `./button`.

45 folders were created this way — `libs/shared/design-system/primitives/src/lib`
(23), `libs/shared/design-system/compounds/src/lib` (3), `apps/garage/web/src/lot` (6),
`apps/garage/web/src/shell` (7) and `apps/garage/web/src/shell/admin` (6) — moving roughly
120 files. Measured over the whole move: 152 files changed, 196 insertions,
196 deletions, perfectly paired — every line touched was an import path, save
one `jest.mock` string literal that named a moved file.

A second, smaller change rode with the same convention: eight long components
were examined, and seven of them had a private subcomponent or a pure-function
module pulled out into its own file in the same folder (below, "Splitting the long
files").

## Why no `index.ts`

The alternative — `button/index.tsx`, `button/index.spec.tsx` — was
considered and rejected. Two costs, neither hypothetical in a codebase this
size:

- **A directory of `index.tsx` files is unreadable in the two places that
  matter most.** An editor's tab strip shows the file name, not the folder;
  fifteen tabs all reading "index.tsx" tell you nothing. A stack trace or a
  coverage report is the same problem in a different tool.
- **A barrel is a file that can drift from what it re-exports.** 45 folders
  means 45 `index.ts` files, each one more surface that has to be kept in
  sync with a rename, a new export, or a component that stops needing a
  file. `button/button.tsx` cannot drift from itself.

The cost of the naming rule is one extra path segment per import —
`./button/button` instead of `./button` — paid once, at the call site, in
exchange for every import saying exactly which file it means without
following a redirect.

## What counts as a group, and what doesn't

Four shapes appear in `apps/garage/web` and `libs/shared/design-system`; only the first
gets a folder.

1. **A component with at least one companion** (a spec, a story, or both).
   This is the case the rule is for, and it is the 45 folders above.
2. **A component with no companion.** `app-top-bar.tsx`, `brand.tsx` and
   `settings-page.tsx` (all in `apps/garage/web/src/shell`) stay flat — there is
   nothing to group them with, and a folder holding one file says nothing a
   flat file didn't already say.
3. **A cross-cutting spec with no component of its own.** `contrast.spec.tsx`
   and `disabled-styling.spec.tsx` (each exercising seven primitives at once)
   and `admin-panels.spec.tsx` are not any one component's companion, so they
   stay where they were. `admin-panels.spec.tsx` is why the four
   `admin-*-panel.tsx` files (`admin-day-panel.tsx`, `admin-spots-panel.tsx`,
   `admin-users-panel.tsx`, `admin-window-panel.tsx`) stay flat too: none of
   them has its own spec, so foldering any one would produce a one-file
   directory and leave the spec that actually covers it orphaned one level up.

4. **A shared helper module with its own spec.** `cx.ts`, `gap.ts` and
   `padding.ts` (primitives), `initials.ts` (shell), `admin-errors.ts`
   (admin) and `lot-view.ts` (lot) each sit flat beside their own
   `.spec.ts`. A spec is a companion, so shape 1 read on its own would
   folder these — it does not, because they are not components, and the
   sole-importer rule below governs them instead: every one has several
   importers, so it stays where every importer can reach it without
   descending into a sibling's folder.

## The sole-importer rule for `.ts` helpers

A pure-function/view module moves into a component's folder only if exactly
one non-spec file imports it — the same test the design applies to any
private implementation detail. Measured **before the splitting below**, which
is when the placement was decided:

| Module                | Importers            | Moved?             |
| --------------------- | -------------------- | ------------------ |
| `bulk-view.ts`        | 1 (`bulk-modal.tsx`) | into `bulk-modal/` |
| `lot-view.ts`         | 5                    | stayed flat        |
| `calendar-grid.ts`    | 2                    | stayed flat        |
| `admin-errors.ts`     | 5                    | stayed flat        |
| `use-current-user.ts` | 6                    | stayed flat        |

A helper with more than one importer is shared state between components that
do not otherwise know about each other; putting it inside one of their
folders would make the other importers reach into a sibling's directory for
something that isn't private to it. `calendar-grid.ts` in particular is
shared by `bulk-modal/` and `date-picker-dialog/` for exactly this reason —
it stays at `apps/garage/web/src/lot/calendar-grid.ts`, not inside either.

The splitting then added one importer to two of these: `bulk-view.ts` now has
two (`calendar-table.tsx` joined it) and `lot-view.ts` has six
(`spot-tile.tsx`). Neither changes its placement, and for opposite reasons —
`bulk-view.ts`'s second importer lives inside the folder it moved into, so it
is still private to that group, while `lot-view.ts` only moved further from
the threshold. The counts are recorded here as they were when the decision was
taken; re-measure before citing them.

## Splitting the long files

Part of the same effort pulled a private piece out of seven of the eight
components that had grown long. Results:

| File                                        | Before | After | Extracted                                          |
| ------------------------------------------- | ------ | ----- | -------------------------------------------------- |
| `lot/lot-grid/lot-grid.tsx`                 | 319    | 91    | `car-glyph.tsx`, `spot-tile.tsx`                   |
| `primitives/…/dismissable-layer.tsx`        | 325    | 165   | `layer-registry.ts`                                |
| `shell/admin/…/admin-spots-screen.tsx`      | 449    | 321   | `category-band.tsx`, `spot-form-dialog.tsx`        |
| `shell/settings-screen/settings-screen.tsx` | 456    | 366   | `ics-section.tsx`                                  |
| `lot/bulk-modal/bulk-modal.tsx`             | 531    | 456   | `calendar-table.tsx`, `schedule-preview-modal.tsx` |
| `compounds/…/data-table.tsx`                | 418    | 396   | `compare-sort-values.ts`                           |
| `primitives/…/dropdown.tsx`                 | 375    | 368   | `dropdown-separator.tsx`                           |
| `lot/lot-screen/lot-screen.tsx`             | 331    | 331   | —                                                  |

Two of these are worth naming honestly rather than folding into the average.
**`dropdown.tsx`'s** further extraction — a hook for its keyboard/focus
logic — was considered and declined: the state it manages is threaded through
enough of the component's render that pulling it into a hook would have
reordered the hook calls or moved the logic sideways behind an indirection,
for a file that was already inside a normal size once the separator came out.
**`lot-screen.tsx`** had no extraction at all: nothing in it is a private
subcomponent or a helper with a single importer, so there was nothing to
split off it that would not have been an indirection for its own sake. Both
are deliberate, not incomplete.

A subcomponent taken out in this step is **not exported from the lib's public
API** and gets **no Storybook story**. `plan.md`'s "every primitive and
compound gets a story" rule is about what a lib exposes to the rest of the
workspace; `car-glyph.tsx`, `layer-registry.ts`, `compare-sort-values.ts` and
the rest are private to the component they were pulled out of, same as they
were before this task, when they were private code inside one file instead of
private code inside one folder.

## What did not change

The public API of both design-system libs (`@garage/design-system/primitives`,
`@garage/design-system/compounds`) is unchanged — every export that existed
before this task still exists, from the same name, at the same import
specifier. Only the paths inside each lib's own `export * from '…'` lines
moved, to point at the new folder.

## How it is verified

`npm run build`, `npm run typecheck` and `npm test` all pass after the move —
a `.spec.tsx` beside its component under test still resolves it with a
same-directory `./name` import, and Storybook's story glob
(`libs/shared/design-system/*/.storybook`) still discovers every `*.stories.tsx`
regardless of how many directories deep it sits. `npx nx run-many -t build,build-storybook`
covers both libs' Storybook builds, which would fail to resolve a story whose
component moved without its import following it.

## Consequences and residuals

- **`TODO.md` proposes collapsing `libs/shared/design-system` from three packages
  (`tokens`, `primitives`, `compounds`) into one.** If that happens, it will
  re-churn the design-system half of this layout — every primitive and
  compound folder moves again, though the folder convention this record
  states does not change; only the package boundary they sit inside does.
- **`dropdown.tsx` (368 lines) and `lot-screen.tsx` (331 lines) are
  deliberately left long.** Neither is a case this task's extraction rule
  covers — see "Splitting the long files" above — and a future change that
  tries to shrink either by pulling out a hook or a helper should check
  first whether the same reasoning still applies, rather than assuming the
  earlier pass simply missed it.
