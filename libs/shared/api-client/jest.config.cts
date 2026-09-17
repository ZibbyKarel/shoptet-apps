/**
 * This project imports `@orpc/client`, `@orpc/client/fetch` and (transitively,
 * through `@garage/contract`) `@orpc/contract`, all published ESM-only,
 * while Jest runs here as CommonJS.
 *
 * The `transformIgnorePatterns` half of that fix now lives in
 * `jest.preset.js` — `doc/decision/0020-*` asked for the consolidation and
 * `doc/decision/0297-*` is where it happened. What stays local is the part that
 * cannot be shared:
 *
 * - the `.mjs` transform entry, because this project uses **ts-jest** (which
 *   needs `allowJs`, set in `tsconfig.spec.json`) where the React projects use
 *   babel-jest;
 * - `mjs` in `moduleFileExtensions`, without which resolution never finds the
 *   files at all.
 */
module.exports = {
  displayName: 'api-client',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.mjs$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'mjs', 'html'],
  coverageDirectory: '../../../coverage/libs/shared/api-client',
};
