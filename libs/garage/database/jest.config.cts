/**
 * The three `@orpc` lines are the ones `doc/decision/0020-*` describes: this
 * project's specs import `@garage/contract`, which pulls in the ESM-only
 * `@orpc/contract`, and Jest runs here as CommonJS. This is the **second**
 * copy of that configuration — per decision 0020, the third project to need it
 * (Task 11 or 12) moves it into `jest.preset.js` instead of copying again.
 *
 * The pattern is built by `jest.preset.js`'s `buildTransformIgnorePatterns`
 * rather than hand-rolled here — a plain `/node_modules/(?!(?:pkg)/)` regex
 * never matches under pnpm's nested `.pnpm/<name>@<version>/node_modules/<name>`
 * layout; see that function's doc comment.
 */
const { buildTransformIgnorePatterns } = require('../../../jest.preset.js');

module.exports = {
  displayName: 'database',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.mjs$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  transformIgnorePatterns: [buildTransformIgnorePatterns(['@orpc'])],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'html'],
  coverageDirectory: '../../../coverage/libs/garage/database',
};
