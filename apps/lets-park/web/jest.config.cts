const nextJest = require('next/jest.js');
const { buildTransformIgnorePatterns } = require('../../../jest.preset.js');

/**
 * Packages on this app's test path that are published ESM-only — `"type":
 * "module"`, or a lone `.mjs` build, with no `require` condition — while Jest
 * runs as CommonJS. Same list and same shape as `libs/shared/i18n`'s and
 * `libs/query`'s; the reasoning is in
 * `doc/decision/0020-orpc-is-esm-only-jest-must-transpile-it.md` and
 * `doc/decision/0025-next-intl-esm-jest-transform.md`.
 *
 * Decision 0020 asks that a third project needing this consolidate the block
 * into the root `jest.preset.js`. **That would not help here**, and neither
 * would handing the list to `createJestConfig`. Both were measured on Next
 * 16.1.7 (`next/dist/build/jest/jest.js:197-210`):
 *
 * - a `transformIgnorePatterns` set in the **preset** never reaches the
 *   resolved config. `next/jest` always writes the key, and Jest only falls
 *   back to a preset's value for a key the project config leaves unset.
 * - a `transformIgnorePatterns` in the object passed to `createJestConfig` is
 *   **appended** after Next's own entries — Next's source says so in a comment
 *   ("Custom config can append to transformIgnorePatterns but not modify it")
 *   and a sentinel probe comes back last in the array. It is *not* replaced;
 *   an earlier claim here said otherwise and was wrong.
 *
 * Appending is useless all the same, which is why the override below still has
 * to overwrite the resolved array. `transformIgnorePatterns` is a **union**:
 * Jest leaves a file untransformed if it matches *any* entry. `next.config.ts`
 * sets `transpilePackages: ['geist']`, so Next's first entry is
 * `/node_modules/(?!.pnpm)(?!(geist)/)`, which already matches every
 * `node_modules` path but `geist`'s — a negative-lookahead exemption added
 * after it cannot subtract from a match that already happened. Appending
 * instead of overwriting was tried: 4 of the 8 suites fail with
 * `SyntaxError: Unexpected token 'export'` out of `next-intl`.
 *
 * Next's own entry above already knows to let `.pnpm` defeat its match —
 * that's what `(?!.pnpm)` does. The replacement below uses
 * `jest.preset.js`'s `buildTransformIgnorePatterns` for the same reason: a
 * plain `/node_modules/(?!(?:pkg)/)` shape never reaches the real package two
 * directories down (`.pnpm/<name>@<version>/node_modules/<name>/...`).
 */
const esmOnlyPackages = [
  // `@lets-park/api-client` and `@lets-park/contract`.
  '@orpc',
  // `@lets-park/i18n`.
  'next-intl',
  'use-intl',
  'intl-messageformat',
  '@formatjs',
  '@schummar',
  'icu-minify',
  // `@lets-park/auth`.
  'next-auth',
  '@auth',
  'jose',
  'oauth4webapi',
  '@panva',
  'preact',
  // `@lets-park/design-system/compounds` — `DataTable`, reached through the
  // barrel by anything importing `EmptyState`. Only these four `@tanstack`
  // packages, never the whole scope: `@tanstack/react-query` ships a `require`
  // condition and must keep being ignored.
  '@tanstack/react-table',
  '@tanstack/table-core',
  '@tanstack/react-store',
  '@tanstack/store',
];

const createJestConfig = nextJest({
  dir: './',
});

const config = {
  displayName: 'web',
  preset: '../../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/apps/lets-park/web',
  // jsdom plus the Web APIs it does not implement (`fetch`, `Request`,
  // `Response`, the stream classes). See `jest-environment-web.cjs` and
  // `doc/decision/0037-*`.
  testEnvironment: '<rootDir>/jest-environment-web.cjs',
};

const jestConfig = createJestConfig(config);

module.exports = async () => {
  const resolved = await jestConfig();
  // Disable SWC path alias resolution — handled by Nx jest resolver.
  for (const value of Object.values(resolved.transform)) {
    if (Array.isArray(value) && value[1]?.resolvedBaseUrl) {
      value[1] = { ...value[1], resolvedBaseUrl: undefined };
    }
  }
  // Overwrite rather than append: see `esmOnlyPackages` above. Next's own
  // `/node_modules/(?!.pnpm)(?!(geist)/)` entry would otherwise keep matching,
  // and one match is all it takes. The CSS-module entry is Next's own and is
  // kept — dropping it would send `*.module.css` through the JS transform.
  resolved.transformIgnorePatterns = [
    buildTransformIgnorePatterns(esmOnlyPackages),
    '^.+\\.module\\.(css|sass|scss)$',
  ];
  return resolved;
};
