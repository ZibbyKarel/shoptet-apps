/**
 * One Jest project for the whole design system.
 *
 * The tokens layer used to run under `testEnvironment: 'node'` with ts-jest,
 * because it is plain TypeScript that reads files off disk. It runs here under
 * jsdom + babel-jest with the other two layers instead: measured before the
 * merge, its two suites and seventeen tests pass unchanged under this config —
 * jsdom is a superset for their purposes, and `theme-css.spec.ts` compiles real
 * Tailwind and reads `assets/` either way. What ts-jest incidentally gave those
 * specs was typechecking; `tsconfig.spec.json` includes them and the
 * `typecheck` target runs it, so that is not lost.
 *
 * `@tanstack/react-table` v9 and its dependency chain (`@tanstack/table-core`,
 * `@tanstack/react-store`, `@tanstack/store`) are published ESM-only —
 * `"type": "module"`, no `require` condition in `exports` — while Jest runs
 * here as CommonJS. Without the `transformIgnorePatterns` line below,
 * `data-table.spec.tsx` fails to even parse with `SyntaxError: Cannot use
 * import statement outside a module`. `doc/decision/0020-orpc-is-esm-only-jest-must-transpile-it.md`.
 *
 * Overriding `transformIgnorePatterns` **replaces** the value from
 * `jest.preset.js` outright (Jest merges a preset shallowly), so the preset's
 * own union of ESM-only packages would be dropped by naming only the four
 * above. The list below therefore restates it: nothing in the design system
 * imports `@orpc` or `next-intl` today, and listing them costs nothing —
 * `transformIgnorePatterns` only says a file *may* be transformed if it is
 * loaded. Only these packages are named, not the whole `@tanstack` scope:
 * `@tanstack/react-query` (used by `libs/query`) does ship a `require`
 * condition and must keep being ignored.
 *
 * The pattern is built by `jest.preset.js`'s `buildTransformIgnorePatterns`
 * rather than hand-rolled here — a plain `/node_modules/(?!(?:pkg)/)` regex
 * never matches under pnpm's nested `.pnpm/<name>@<version>/node_modules/<name>`
 * layout; see that function's doc comment.
 */
const { buildTransformIgnorePatterns } = require('../../../jest.preset.js');

const esmOnlyPackages = [
  // From jest.preset.js — restated because this override replaces it.
  '@orpc',
  'next-intl',
  'use-intl',
  'intl-messageformat',
  '@formatjs',
  '@schummar',
  'icu-minify',
  // This project's own: the TanStack Table chain behind the DataTable compound.
  '@tanstack/react-table',
  '@tanstack/table-core',
  '@tanstack/react-store',
  '@tanstack/store',
];

module.exports = {
  displayName: 'design-system',
  preset: '../../../jest.preset.js',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  transform: {
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  transformIgnorePatterns: [buildTransformIgnorePatterns(esmOnlyPackages)],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../../coverage/libs/shared/design-system',
};
