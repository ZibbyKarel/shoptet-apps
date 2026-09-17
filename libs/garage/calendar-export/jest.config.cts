/**
 * These specs import `@garage/contract`, which pulls in the ESM-only
 * `@orpc/contract`, and Jest runs this project as CommonJS. The
 * `transformIgnorePatterns` half of that fix now lives in `jest.preset.js`
 * (`doc/decision/0020-*` asked for it; `doc/decision/0297-*` did it); the
 * `.mjs` transform entry and `moduleFileExtensions` stay here because they
 * depend on this project running ts-jest.
 *
 * Neither of this lib's own packages needs transpiling: `ical-generator@11.1.1`
 * and `ical.js@2.2.1` are both `"type": "module"` but both publish a `require`
 * condition (`dist/index.cjs` and `dist/ical.es5.cjs`), which Jest's CommonJS
 * loader resolves unaided. Verified by `require()`-ing both from a plain
 * `.cjs` script before this file was written.
 */
module.exports = {
  displayName: 'calendar-export',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.mjs$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'mjs', 'html'],
  coverageDirectory: '../../../coverage/libs/garage/calendar-export',
};
