# design-system

One Nx project, three layers, three entry points. The layers are directories
under `src/`, not separate packages — see
`doc/decision/0301-the-design-system-is-one-package-and-the-layer-rule-moved-to-lint-paths.md`.

| Layer      | Entry point                        | Directory        |
| ---------- | ---------------------------------- | ---------------- |
| tokens     | `@garage/design-system/tokens`     | `src/tokens`     |
| primitives | `@garage/design-system/primitives` | `src/primitives` |
| compounds  | `@garage/design-system/compounds`  | `src/compounds`  |

The direction is tokens → primitives → compounds, one way only. Compounds may
import primitives and tokens; primitives must never import compounds; tokens
import neither. That is enforced by path-scoped `no-restricted-imports` rules in
this project's own `eslint.config.mjs`, which catch both the alias spelling and
a relative escape.

## tokens

Colours, spacing, typography, radius, shadows, motion, layout and overlay
values as TS objects — the source of truth. `assets/tokens.css` (CSS custom
properties) is **generated** from them and committed; `assets/theme.css` is the
consumer entry point that pulls in Tailwind and `tokens.css`. Nothing here
depends on React: a token is a string, not a component.

```bash
npx nx run design-system:generate-css   # rewrite assets/tokens.css from the TS source
```

Run it and commit the diff whenever a token value changes —
`generate-css.spec.ts` fails CI if you forget
(`doc/decision/0010-generated-tokens-css-is-committed.md`).

## primitives

Button, Input, Select, Checkbox, Radio, Badge, Avatar, Switch, Stepper.

Presentation only, and strictly domain-free: nothing in here knows what the app
reserves or who reserves it. Every colour, radius, spacing and type size comes
from `@garage/design-system/tokens`; no value is written by hand.

## compounds

DataTable, EmptyState, ConfirmDialog.

Built from `@garage/design-system/primitives`, and strictly domain-free —
fixtures and stories included.

This layer is also the **wrapper for `@tanstack/react-table`** — the single
place in the workspace allowed to import it, and the only block in
`eslint.config.mjs` that exempts it. No TanStack type crosses `DataTable`'s
props.

## Commands

```bash
npx nx run-many -t lint,typecheck,test -p design-system
npx nx run design-system:storybook          # one Storybook for all layers, port 4400
npx nx run design-system:build-storybook    # static build into dist/storybook/design-system
```

Full documentation — component APIs, conventions and how to add a primitive or
a compound — is in `doc/design-system.md`.
