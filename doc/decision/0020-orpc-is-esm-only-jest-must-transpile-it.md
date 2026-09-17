# 0020 – `@orpc/contract` is ESM-only; Jest has to transpile it

**Date:** 2026-08-28 · **Status:** accepted · **Applies to:** every project whose tests import `@garage/contract`

## What

`@orpc/contract@1.15.0` is published **only as ESM**: `"type": "module"`, a
single build `dist/index.mjs`, no `require` condition in `exports`. Jest
projects in this workspace run as CommonJS, so importing it fails with
`SyntaxError: Cannot use import statement outside a module`.

The fix lives in `libs/garage/contract/jest.config.cts` and
`libs/garage/contract/tsconfig.spec.json`:

```js
transform: {
  '^.+\\.[tj]s$':  ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  '^.+\\.mjs$':    ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
},
transformIgnorePatterns: ['/node_modules/(?!(?:@orpc)/)'],
moduleFileExtensions: ['ts', 'js', 'mjs', 'html'],
```

plus `"allowJs": true` in `tsconfig.spec.json` (ts-jest won't pick up `.mjs`
without it).

The version is pinned **exactly** (`"@orpc/contract": "1.15.0"`,
`--save-exact`). oRPC 2.0 is still beta, and the contract lib is a binding
artifact — a prerelease has no place in it.

## Why

All three lines do something different, and if any one is missing, the error
looks the same:

- **`transformIgnorePatterns`** — by default Jest transforms **nothing** under
  `node_modules`. Without an exception for `@orpc`, the unmodified `import`
  reaches the CJS loader as-is.
- **`.mjs` in `transform`** — the default pattern is only `.[tj]s`, so the file
  wouldn't be skipped, but it also wouldn't be processed.
- **`mjs` in `moduleFileExtensions`** — without it the resolver can't find the
  file at all.

The alternatives were worse: switching the project to native ESM in Jest means
`--experimental-vm-modules` and a broken `jest.config.cts`; a custom CJS shim
would be extra code that has to be maintained across every oRPC minor.

## How

The configuration lives only in `libs/garage/contract` for now, since it's the only
project that imports `@orpc/contract`. **Tasks 11 (`libs/shared/api-client`) and 12
(`apps/garage/api`) will hit the same issue** the moment their tests touch
`@garage/contract` — they'll need to copy these three lines.

> Once a **third** project needs it, move the configuration into
> `jest.preset.js` at the root, so the copies can't drift apart. Until then,
> duplication is cheaper than a global setting nobody dares to change.

## Risk if this is wrong

Transpiling `node_modules` slows tests down — today by a fraction of a second,
since it's one small package. If someone extends
`transformIgnorePatterns` to more packages, it will start to show.

The second risk is silent drift: `allowJs: true` is in `tsconfig.spec.json`
**because of Jest**, not because of types. That file's `include` never covers
`node_modules`, so the `tsc --noEmit` program isn't widened by it — but if
someone loosens `include`, typecheck will start checking third-party JS too.
