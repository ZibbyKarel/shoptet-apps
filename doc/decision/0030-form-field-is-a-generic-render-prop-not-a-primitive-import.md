# 0030 – `FormField` is a generic render prop; `libs/shared/form` does not import the design system

**Date:** 2026-08-28 · **Status:** accepted · **Task:** 18 (`libs/shared/form`)

## What

`FormField` (`libs/shared/form/src/lib/form-field.tsx`) doesn't accept a primitive's name or render
one itself — it takes `name` and a render prop `render({ field, error })`, where `field` is
`ControllerRenderProps` (`value`/`onChange`/`onBlur`/`name`/`ref`) and `error` is the message
from the corresponding Zod issue. The caller calls `Input`/`Select`/`Checkbox`
(`@garage/design-system-primitives`) itself and spreads the props onto it.

Consequence: **`libs/shared/form` (the production source) does not import the design system at
all.** The only place `@garage/design-system-primitives` appears inside `libs/shared/form` is a
single test file (`app-form.spec.tsx`), thanks to the separate ESLint override described
below.

## Why

The Task 18 brief describes `FormField` as "rendering DS primitives (Input, Select,
Checkbox)". A literal reading of that ("FormField imports and switches between three
primitives") would mean `libs/shared/form` (tag `type:util`) depends on `design-system-primitives`
(tag `type:ui`) — which `eslint.config.mjs`/`doc/workspace.md` forbid: `type:util` may only
depend on `type:util`/`type:contract`, because the layering `app → feature → ui → util →
contract → foundation` is acyclic only in this direction (`ui` is already allowed to depend
on `util`, so a reverse edge would close the graph into a cycle). Global constraint 5 also
states that design-system composition lives "only in `apps/garage/web`" (domain and non-domain
alike) — `libs/shared/form` belongs there no more than `libs/shared/i18n` does.

The more natural reading of the brief's sentence is as a description of the **resulting
use** ("what FormField is for"), not a specification of its imports — which matches the
wording further down in the brief: "your `FormField` connects the two [the primitive and
validation]". A generic render prop makes this connection just as well as hard-wired
primitives, and in addition:

- **It keeps the API small** (one component, not three/four variants for
  Input/Select/Checkbox/future primitives),
- **It adds no coupling** between the wrapper and the design system — Task 8
  (Modal/Dropdown/Tabs/Tooltip) was stopped and never merged; if `FormField` knew about a
  specific set of primitives, every future primitive would require a change in `libs/shared/form`,
- **Type safety is preserved** — `useController<TFieldValues, TName>` types `field` exactly
  according to the schema passed into `useAppForm`; a generic render prop changes nothing
  about that.

## How

- `FormField<TFieldValues, TName>({ name, render, control? })` calls `useController` (not
  `register`) precisely because `useController` already returns `fieldState.error` resolved
  for the specific `name` — `FormField` doesn't duplicate the path to the error, it just
  passes it on.
- The test that proves the whole point of the wrapper (a form built from `@garage/form` +
  `@garage/design-system-primitives`, with no direct `react-hook-form` import) still has
  to live in `libs/shared/form`, because Task 18 is only allowed to touch `libs/shared/form/**`. This is
  solved with a separate `depConstraints` override just for `libs/shared/form/**/*.spec.{ts,tsx}`
  (`eslint.config.mjs`, `formSpecDepConstraints`): a clone of the main `DEP_CONSTRAINTS`
  array where `type:util` is additionally allowed to depend on `type:ui` — but **only** for
  files matching that glob, not for the rest of `libs/shared/form` and not for any other `type:util`
  lib. Alongside it, `allowCircularSelfDependency: true`, because the demo test imports
  `@garage/form` via its own alias from inside `libs/shared/form` (to prove the public API is
  sufficient by itself), and without this the rule would flag it as a circular
  self-dependency.
- Verified with **four** temporary probe files (deleted afterward, see `doc/workspace.md` on
  the obligation to verify path-scoped rules, not just that lint passes):

  | probe | location | expected | result |
  | --- | --- | --- | --- |
  | `import 'react-hook-form'` | `libs/shared/form/src/lib/*.ts` | allowed | lint green |
  | `import 'react-hook-form'` | `libs/shared/i18n/src/lib/*.ts` | forbidden | `no-restricted-imports … use @garage/form` |
  | `import '@garage/design-system-primitives'` | `libs/shared/form/src/lib/*.spec.tsx` | allowed | lint green |
  | `import '@garage/design-system-primitives'` | `libs/shared/form/src/lib/*.ts` (not `.spec.`) | forbidden | `type:util … can only depend on … "type:util", "type:contract"` |

  The last row is the one that proves the override targets only the tests, not the whole
  lib — without it, it would be indistinguishable whether the override had accidentally
  opened up `type:ui` for `libs/shared/form` as a whole.

## Risk if this is wrong

If a future task (23–27, 31) genuinely needs `libs/shared/form` itself to render specific
primitives (e.g. because of shared logic around `FieldOwnProps` that would otherwise be
repeated in every feature), that will require either moving this composition into a new
`type:feature` lib (free to depend on `ui`+`util`), or deliberately revisiting the layering
and recording it as a new decision — not quietly widening `type:util → type:ui` globally,
which would open the same path to every other wrapper (`libs/query`, `libs/shared/api-client`, …),
including ones that have no reason to know about the design system.
