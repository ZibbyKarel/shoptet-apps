# 0301 – The design system is one package, and the layer rule moved to lint paths

**Date:** 2026-09-08 · **Status:** accepted · **Task:** `TODO.md` item 1 ·
**Supersedes the mechanism of:** `doc/decision/0007-*` (the `ds:` tag dimension)

## What

`libs/shared/design-system` was three Nx projects — `design-system-tokens`,
`design-system-primitives`, `design-system-compounds` — nested in one
directory. It is now **one** project, `design-system`, and the three layers are
three directories under one `src/`:

```
libs/shared/design-system/src/{tokens,primitives,compounds}/
```

The three import specifiers are **unchanged**:
`@garage/design-system/tokens`, `@garage/design-system/primitives`,
`@garage/design-system/compounds`. They were three `paths` entries in
`tsconfig.base.json` before and they are three `paths` entries now; only the
right-hand side moved. That is the whole point of the change and it is the one
invariant everything below is arranged to protect: 109 files moved inside the
package (121 renames, 153 files changed across the three commits) and **no line
outside `libs/shared/design-system/` that mentions `@garage/design-system` changed
at all** — proved by diffing the workspace-wide grep for that string before and
after, filtered to exclude the package's own files.

Six targets survive on the one project: `typecheck`, `test`, `lint`,
`generate-css`, `storybook`, `build-storybook`. Three `project.json` became one
and three `jest.config.cts` became one; the twelve `tsconfig*.json` became
five — `tsconfig.json` plus the four the `typecheck` target compiles (`lib`,
`spec`, `storybook`, `scripts`). `nx show projects` lists `design-system` and
none of the old three.

## Why one package

The three projects never bought a boundary anyone used. They shared a
`.babelrc`, they shared a Tailwind setup, two of them declared
`implicitDependencies: ["design-system-tokens"]` because the real coupling is
CSS and Nx could not see it, and every consumer imported all three. What they
cost was three of everything: three lint configs to keep in sync, three Jest
configs, three `typecheck` targets, three Storybook wirings, two Storybook
ports. A boundary that produces no separation and three copies of every config
is overhead wearing a boundary's clothes.

## The `plan.md` collision, stated plainly

`plan.md` line 51 reads:

> Compounds smí importovat primitivy a tokeny, nikdy obráceně (**vynuť Nx
> tagy**).

"Enforce with Nx tags." The tags are gone. This record is where that is
reconciled rather than glossed:

- **The rule is what `plan.md` binds, and the rule is unchanged.** Compounds may
  import primitives and tokens; primitives may not import compounds; tokens may
  import neither. It is still machine-enforced, still fails the build, and is
  probed rather than asserted (below).
- **The mechanism is what changed**, and the parenthetical named a mechanism,
  not an outcome. `plan.md`'s "(vynuť Nx tagy)" is now **historical**: it
  records how the rule was enforced between Fáze 2 and this change.
- **The repository owner was asked about exactly this** — the packaging change
  necessarily invalidates the enforcement mechanism the spec names — and chose
  to keep the rule enforced by other means rather than keep three projects to
  keep three tags. That is a deliberate divergence from a sentence of the
  binding spec, taken by the person the spec belongs to, and this is the record
  of it.

`plan.md` itself is git-ignored and does not travel with a worktree, so the
path-only repointing of its Fáze 2/3/4 sentences was handed to the owner as a
patch rather than committed on this branch. Anyone reading `plan.md` and
finding `libs/shared/design-system/tokens` should read `libs/shared/design-system/src/tokens`
and this record.

## Why `no-restricted-imports` and not tags

`@nx/enforce-module-boundaries` constrains dependencies **between projects**. A
project carries one tag set. Three `ds:*` `depConstraints` on one project have
nothing left to match: `ds:primitives` cannot be both the source and the target
of a rule about the same project's own files, and the rule never fires on an
intra-project import at all.

The tempting non-answer is to leave the three constraints in the root config
because they are harmless. They are not harmless. **This workspace has shipped
a rule that reads as enforcement and enforces nothing four times already** — the
`clsx` allow-list probed at Task 8's merge is one of them, recorded in
`doc/workspace.md` — and each time the cost was the same: someone read the
config, believed the boundary was held, and stopped checking. A dead constraint
is worse than no constraint, because no constraint at least does not lie. The
`ds:` block in the root `eslint.config.mjs` was therefore deleted and replaced
by a comment saying where the rule went.

Where it went: `libs/shared/design-system/eslint.config.mjs`, as path-scoped
`no-restricted-imports` blocks — one for `src/tokens/**`, one for
`src/primitives/**`, one for `src/compounds/**` (which carries no layer ban,
because compounds may import both, and that asymmetry *is* the rule).

## Why both spellings are banned, and why each rule was fired

Each layer's group bans two spellings of the same reach:

```js
group: ['**/compounds', '**/compounds/**']
```

- the **workspace alias**, `@garage/design-system/compounds` — what the
  existing cross-layer imports use and what a new one will copy;
- a **relative escape**, `../../compounds/lib/data-table/data-table` — what
  someone sidestepping the alias would write.

`**` in a `no-restricted-imports` group matches across path separators, so one
pair of patterns catches both. A rule that caught only the alias would be
bypassable by anyone who ran the auto-import a second way, and would have been
the fifth entry in the list above.

Every rule was **probed by firing it**, not by reading it. Thirteen probes in
all: an offending import added to a real file, `npx nx lint design-system
--skip-nx-cache` run, the output checked for the rule's own message, then the
file reverted. Five of them cover the layer rule — tokens→primitives in both
spellings, primitives→compounds in both spellings, and tokens→compounds by
alias. That is every illegal combination at least once and both spellings
exercised against both banning layers; the sixth cell (tokens→compounds by
relative escape) shares its pattern pair with the alias probe on the same rule
and was not fired separately. The legal direction was probed clean in the same
pass — all 16 cross-layer imports lint fine — which is the half that catches a
rule so broad it bans the intended imports too. The `@tanstack/react-table`
exemption was probed the same way in all five of its cases: banned under
`src/tokens` and `src/primitives`, in both the static and the dynamic spelling,
allowed only under `src/compounds`, and still banned outside the package.

Exit code alone was not the oracle for those probes, and it should not be for a
future one: while they were run, four Storybook files sat in no `tsconfig` and
lint exited 1 unconditionally. Each probe therefore recorded the **problem
count** — 4 at baseline, 6 with the offending import, 4 again after the
revert — with the parse-error count pinned at 4 throughout, so the extra problem
is demonstrably the rule under test.

The React ban on the tokens layer was the one that nearly escaped. `scripts/
build-tokens-css.ts` used to live under `tokens/` and inherited that ban by
being in the project; after the merge it sits at the package root and the
`src/tokens/**` glob no longer reached it. `scripts/**/*.ts` was added to the
block, and the probe — appending `import React from 'react'` and running lint —
now names React and exits 1. Before the glob change, the same probe passed.

## Why cross-layer imports keep the alias form

Sixteen imports inside the package cross a layer, all written as
`@garage/design-system/primitives`. They were **not** rewritten to relative
paths. `@nx/enforce-module-boundaries` reads a project importing its own alias
as a circular self-dependency, so the project's config sets
`allowCircularSelfDependency: true` — the same thing `libs/shared/form`'s spec block in
the root config does, for the same reason.

Rewriting them to `../../primitives/index` instead would have been sixteen more
changed lines for no gain, and it would have made the package's internal imports
look different from every consumer's — the alias is the documented way in, and a
compound reaching for a primitive is doing exactly what an app does. Keeping the
alias also keeps this change honest as *packaging*: a diff that rewrote imports
would be a migration, and the byte-identical import surface could not have been
claimed.

## What was measured

- **Typecheck.** The three layers had three `tsconfig.lib.json`, with slightly
  different strict flags. The merged config takes the **union** of the three —
  the strictest reading of each — and `tsc --noEmit` passes across all **109**
  files. Nothing was relaxed to make the merge type-check; the tighter of each
  pair won and no file needed changing. The tokens layer's `module: "commonjs"`
  was dropped as irrelevant under `--noEmit` (`tsconfig.scripts.json` keeps it
  where `ts-node` actually needs it), and `declaration: true` with it — nothing
  in this workspace emits declarations from a path-alias lib.
- **Test.** The tokens project ran under a node environment with `ts-jest`; the
  other two under jsdom with `babel-jest`. The tokens layer's **2 suites / 17
  tests** pass unchanged under jsdom + `babel-jest`, so **one** Jest config
  serves all three layers. The whole project is 33 suites / 361 tests.
- **What that costs:** `ts-jest` type-checks the spec files it compiles as a
  side effect; `babel-jest` strips types and does not. That incidental check is
  not lost, because `tsconfig.spec.json` is one of the four projects the
  `typecheck` target compiles — it is now done deliberately, by the target whose
  job it is, instead of accidentally, by the test runner.
- **Storybook.** 25 stories before the merge, 25 after.
- **CSS.** `apps/garage/web/.next` was wiped and rebuilt, and the emitted stylesheet
  was checked for three markers that only one source can produce: a token custom
  property (`--brand-blue`, which proves the `theme.css` import), a
  primitives-only utility (`peer-checked`), and a compounds-only one
  (`border-collapse`). A `@source` path that is subtly wrong builds green and
  ships an unstyled app; this is the check that sees it.

## What was lost

Two `implicitDependencies: ["design-system-tokens"]` declarations. They existed
because primitives and compounds consume tokens through **CSS custom
properties** — `.storybook/preview.css` imports `assets/theme.css`, and nothing
in TypeScript connects the layers — so `nx affected` would otherwise not re-run
the other two layers after a token change.

Inside one project that edge is free: `nx affected` sees one project and runs
all of it. But the fact the declaration documented is not free, and it is the
kind of thing that gets rediscovered by a broken build. It is written down in
`libs/shared/design-system/project.json` under a `"// implicit deps"` key, and it is
worth repeating here: **a change under `src/tokens` can break the stories and
specs of the other two layers with no TS import connecting them.**

The `ds:tokens` / `ds:primitives` / `ds:compounds` tags are gone with the
projects that carried them. `type:ui` and `scope:web` remain on the one project,
and `type:ui` is what still carries the npm allow-list.

## Storybook, and port 4401

There were two Storybooks: primitives on 4400, compounds on 4401. The reason the
compounds one existed, recorded in `doc/design-system.md`, was that the two libs
were separate Nx projects with separate `lint`, `typecheck` and
`build-storybook` targets, and a shared instance would have had to reach across
the project boundary the `ds:*` tags drew. Merging the projects removed the
boundary that argument rested on.

There is now **one** Storybook, at `libs/shared/design-system/.storybook`, on port
4400, building into `dist/storybook/design-system`. **Port 4401 is free.**

Its `preview.css` needs one `@source '../src'` line where the compounds
Storybook needed two — and the reason the compounds one gave for its second line
still holds and is why this one must not be narrowed to a single layer: a
compound renders primitives, so the utilities the primitives ask for have to be
generated in the compounds' stories too, or every `Button` inside a
`ConfirmDialog` renders unstyled.

## How it is verified

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (which includes
`build-storybook`) and `nx format:check --all` all pass. `web-e2e` — the only
layer that renders these components in a real browser, and therefore the only
one that can see a wrong `@source` root — is 21 passed.
