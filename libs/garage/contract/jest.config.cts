/**
 * `@orpc/contract` is published as ESM only — `"type": "module"` with a single
 * `./dist/index.mjs` and no `require` condition. Jest runs this project as
 * CommonJS, so the package has to be transpiled on the way in:
 *
 * - `transformIgnorePatterns` stops excluding the oRPC packages (Jest skips
 *   everything under `node_modules` by default, which is why the untransformed
 *   `import` statement reached the CJS loader);
 * - the `.mjs` transform entry hands those files to ts-jest, which needs
 *   `allowJs` — set in `tsconfig.spec.json`;
 * - `mjs` joins `moduleFileExtensions` so resolution finds them at all.
 *
 * Every project that imports `@garage/contract` in a Jest test will need the
 * same three lines (Tasks 11 and 12); if a third one appears, move this into
 * `jest.preset.js` instead of copying it again.
 *
 * The pattern is built by `jest.preset.js`'s `buildTransformIgnorePatterns`
 * rather than hand-rolled here — a plain `/node_modules/(?!(?:pkg)/)` regex
 * never matches under pnpm's nested `.pnpm/<name>@<version>/node_modules/<name>`
 * layout; see that function's doc comment.
 */
const { buildTransformIgnorePatterns } = require('../../../jest.preset.js');

module.exports = {
  displayName: 'contract',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.mjs$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  transformIgnorePatterns: [buildTransformIgnorePatterns(['@orpc'])],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'html'],
  coverageDirectory: '../../../coverage/libs/garage/contract',
};
