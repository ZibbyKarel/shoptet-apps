# 0290 – The wrapper ban covers `require()` and dynamic `import()` too

## What

`eslint.config.mjs` gains `restrictWrappedLibrariesDynamically()`, a
`no-restricted-syntax` companion to `restrictWrappedLibraries()`. It is applied
to the same `apps/**` and `libs/**` block, and spread back into each wrapper
lib's own override so that a wrapper may still reach the package it wraps.

## Why

The mandatory-wrapper rule is one of `plan.md`'s non-negotiables, and
`no-restricted-imports` was enforcing exactly one of the three ways to reach a
package. Measured, on a throwaway `apps/garage/web/src/__probe__.ts`:

```ts
export const a = require('socket.io-client');
export async function b() { return import('socket.io-client'); }
export async function c() { return import('next-auth'); }
export const d = require('@tanstack/react-query');
```

`npx nx run web:lint` → **exit 0**, no finding.

`no-restricted-imports` cannot close it: the rule reads `import`/`export`
declarations, not call expressions. `@nx/enforce-module-boundaries` does see a
dynamic import, but it constrains applications not at all here —
`NPM_ALLOWLIST.app` is `['*']` on purpose, because an application depends on
whatever it ships. So for app code, which is precisely the code the wrapper
rule exists to constrain, there was nothing.

No live violation existed anywhere in the tree. This closes the hole before one
does, which is cheaper than closing it afterwards and is the only honest
response to having *measured* that the rule enforces less than it reads as
enforcing.

## How

Two esquery selectors per wrapped package, generated from the same
`WRAPPED_LIBRARIES` map that generates the import ban, so the two lists cannot
drift:

```
ImportExpression[source.value=/^<pkg>(\/|$)/]
CallExpression[callee.name='require'][arguments.0.value=/^<pkg>(\/|$)/]
```

Both escapes in the generated regex are load-bearing and both were found by
running it, not by reading it. An unescaped `.` would let `socket.io-client`
match `socketXio-client`. An unescaped `/` ends the regex literal mid-selector,
and esquery rejected `@tanstack/react-table` outright with
`Syntax error in selector … Expected " ", "]", or [imsu] but "r" found` — the
config failed to load at all, which is at least a loud way to be wrong.

`(\/|$)` is what keeps the ban to the package and its subpaths.

Probed, then deleted:

| Probe | Result |
| --- | --- |
| `require`/`import()` of `socket.io-client`, `next-auth`, `@tanstack/react-query` from `apps/garage/web` | **4 errors**, exit 1, one per call |
| `require('socket.io-clientele')`, `import('next-authentic')` from `apps/garage/web` | clean, exit 0 — no prefix over-match |
| `require`/`import()` of `socket.io-client` inside `libs/garage/realtime-client` | clean, exit 0 — the owner is still exempt |

## Risk

- **`no-restricted-syntax` is a single rule, like `no-restricted-imports`.** A
  later flat-config block that sets it replaces this list outright. That is why
  the helper is exported and why the wrapper-lib overrides spread it, and it is
  the same trap the comment on `restrictWrappedLibraries` already describes.
  The three `libs/shared/design-system/*` configs set only `no-restricted-imports`, so
  they inherit this untouched — which is correct: none of them owns a wrapped
  package.
- **`require.resolve('pkg')` is not matched**, nor is a require through a
  computed string. Both are conscious omissions: the first does not import
  anything, and the second cannot be caught by a linter at all. The rule that
  is claimed here is the rule that was probed.
