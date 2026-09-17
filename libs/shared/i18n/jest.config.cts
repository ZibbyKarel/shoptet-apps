// Two independent ESM-only-package problems land in this one project, both
// shaped like `doc/decision/0020-orpc-is-esm-only-jest-must-transpile-it.md`:
//
// - `@orpc/contract` (a single `.mjs` build), pulled in transitively because
//   `errors.spec.ts` imports `ERROR_CODES` from `@garage/contract` at
//   runtime (not just as a type) — the same reason `libs/garage/contract` itself
//   needs this.
// - `next-intl` and its transitive dependencies (`use-intl`,
//   `intl-messageformat`, `@formatjs/*`, `@schummar/icu-type-parser`,
//   `icu-minify`), all published `"type": "module"` as plain `.js`.
//
// Both package sets are now named in `jest.preset.js`'s `ESM_ONLY_PACKAGES`,
// which is where 0020 asked for them and where `doc/decision/0297-*` put them —
// this project's list was the longest of the eleven copies and is what the
// shared union is built from. What stays here is the babel-jest `.mjs` entry
// and `moduleFileExtensions`, neither of which is shareable across projects
// that use different transformers.
module.exports = {
  displayName: 'i18n',
  preset: '../../../jest.preset.js',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  transform: {
    // The generated negative-lookahead pattern below is Jest's asset
    // transform (images, css, …), and Jest applies whichever `transform`
    // pattern matches *first*. `.mjs` is not in its extension list, so
    // without adding it there too, an `.mjs` file would match this rule
    // before it ever reaches the babel-jest rule meant for it below.
    '^(?!.*\\.(js|jsx|ts|tsx|css|json|mjs)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
    '^.+\\.mjs$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs'],
  coverageDirectory: '../../../coverage/libs/shared/i18n',
};
