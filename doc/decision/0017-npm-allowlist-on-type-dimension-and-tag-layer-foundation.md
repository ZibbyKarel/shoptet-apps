# 0017 – The npm allow-list hangs off the `type:` dimension; `libs/garage/shared-types` gets `layer:foundation`

**Date:** 2026-08-28 · **Status:** accepted · **Resolves:** the Task 3 review, findings S3 and N3

## What

Two changes in `eslint.config.mjs` (plus one tag in
`libs/garage/shared-types/project.json`):

1. **Every `type:` tag gets an `allowedExternalImports`.** Before Task 4, only
   `type:contract` had one; the other eleven tags had none, so they
   **restricted nothing** — `ds:tokens` could import `lodash`, `type:ui` could
   import `@prisma/client`. The lists live in one map, `NPM_ALLOWLIST`, keyed
   by `app` / `feature` / `ui` / `util` / `contract` / `data` / `foundation`.
2. **`libs/garage/shared-types` carries a new tag, `layer:foundation`**, with
   `onlyDependOnLibsWithTags: []` and `allowedExternalImports: []` — i.e. it
   may depend on no workspace lib and no npm package at all. `type:contract`
   now depends on `layer:foundation` instead of on `type:util`.

## Why

### Why only `type:`, and not all twelve tags

The review asked for `allowedExternalImports` to be added "on all eleven
remaining tags". After reading the rule's implementation, though, that isn't
the right fix. In
`@nx/eslint-plugin/dist/src/utils/runtime-lint-utils.js`, the function
`hasBannedImport()` **filters down to every** constraint whose source tag the
project carries, and then returns `.find(...)` — meaning **a single one** is
enough to ban the import:

```js
depConstraints = depConstraints.filter((c) => tags.every((t) => hasTag(source, t)));
return depConstraints.find((constraint) => isConstraintBanningProject(target, constraint, imp));
```

Constraints are therefore **ANDed**, and the resulting allowed set is the
**intersection** of every dimension the project carries. If the lists also
hung off `scope:` and `ds:`, `react` would have to be listed in three lists at
once, and omitting it from any one of them would silently ban it. That's a
worse trap than the original one.

`type:` was chosen because it's the only dimension in the workspace that
**partitions without remainder**: every project carries exactly one `type:`
tag. A list on that dimension therefore covers everything, and no project is
left unrestricted — which was exactly the substance of finding S3. `scope:`
and `ds:` remain purely about dependency direction, which is what they model.

The difference between "missing" and "empty" matters and is worth
remembering:

| notation | behavior |
| --- | --- |
| `allowedExternalImports` missing | **nothing is restricted**, any package passes |
| `allowedExternalImports: []` | **every** npm package is banned |

### Why `layer:foundation`

Finding N3: `type:util` is allowed to depend on `type:contract`, and
`type:contract` is allowed to depend on `type:util` — a cycle at the tag
level. Both directions are legitimate in specific projects, though:

- `libs/shared/api-client` (`type:util`) **must** see the contract — it's its
  wrapper,
- `libs/garage/contract` **must** see `libs/garage/shared-types` (date helpers, enums).

The bug isn't the direction, it's that the `type:util` tag glues together two
different layers: wrappers **above** the contract, and `shared-types`
**below** it. The new tag splits them apart. The resulting layering is
acyclic:

```
app → feature → ui → util → contract → foundation
```

As a side effect, decision `0003` ("`shared-types` must not pull in Zod") is
now enforced for the first time at the graph level, not merely by a
hand-maintained `no-restricted-imports` block naming one package. That block
stays, because it gives a better error message — but it's no longer the only
safeguard.

## How

- `NPM_ALLOWLIST` in `eslint.config.mjs`, one commented key per `type:` tag.
- The `util` list is deliberately **coarse**: it's the union of every package
  from `WRAPPED_LIBRARIES`, because all eight wrappers carry the same
  `type:util` tag. That `libs/shared/form` may only use `react-hook-form` and
  `libs/garage/auth` only `next-auth` is enforced by per-directory
  `no-restricted-imports` overrides — the Nx dimension alone isn't fine-grained
  enough for that.
- `libs/garage/shared-types/project.json`:
  `"tags": ["type:util", "scope:shared", "layer:foundation"]`.
- `type:contract` → `onlyDependOnLibsWithTags: ['layer:foundation']`.

**Verified with temporary probe files** (deleted afterward), not merely by
lint passing:

| probe | expected | result |
| --- | --- | --- |
| `import 'zod'` in `libs/garage/shared-types` | banned | `type:util … not allowed to import "zod"` |
| `import 'react'` in `libs/garage/shared-types` (`react` is in the `util` list) | banned by `foundation` | `layer:foundation … not allowed to import "react"` |
| `import '@garage/design-system/tokens'` in `libs/garage/shared-types` | banned | `layer:foundation cannot depend on any libs with tags` |
| `import 'zod'` in `libs/shared/design-system/tokens` | banned | `type:ui … not allowed to import "zod"` |
| `import '@orpc/client'` in `libs/garage/contract` | banned | `type:contract … not allowed to import "@orpc/client"` |
| `import 'react'` in `libs/shared/design-system/tokens` | **allowed** | lint green |

## Risk if this is wrong

An allow-list is by nature incomplete for libs that don't exist yet
(`type:feature`, `type:data`, and wrappers under `type:util`). When a future
task needs a package that isn't listed, **lint fails naming it**, and the task
adds one line — that's the intended behavior, not a regression: the addition
is visible in review. The opposite mistake (omitting a list entirely) is
silent, and that's exactly what was being fixed here.

Specifically, `type:ui` is pre-populated (React, `clsx`, `tailwind-merge`,
`class-variance-authority`, Storybook, TanStack Table), because Tasks 6–8 on
the design system run concurrently. If it misses the mark, it's one extra
line.

`layer:foundation` is the fourth tag dimension. Exactly one project carries
it, and that's intentional — if a second "zero-dependency" lib appears, it
gets the same tag. If `shared-types` ever genuinely needed an npm dependency,
that's a signal it belongs elsewhere, not a reason to loosen the list.
