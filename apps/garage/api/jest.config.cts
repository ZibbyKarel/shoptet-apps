/**
 * Four dependencies of this app ship ESM only and have to be transpiled on the
 * way into Jest's CommonJS runtime:
 *
 * - `@orpc/contract` (`"type": "module"`, `.mjs` only) — reached through
 *   `@garage/contract`, which the exception filter imports for
 *   `ERROR_DEFINITIONS`. Same three lines as `libs/garage/contract/jest.config.cts`;
 *   see `doc/decision/0020-*`.
 * - `@nestjs/config` v12 (`"type": "module"`, `.js`) — imported by every module
 *   that reads validated env, so any test that builds a Nest testing module
 *   hits it.
 * - `@nestjs/passport` v12 (`"type": "module"`, `.js`) — the `AuthGuard` and
 *   `PassportStrategy` the auth layer is built on (Task 11).
 * - `jose` v6 (`"type": "module"`) — not imported by this app directly, but
 *   `require()`d by `jwks-rsa`, which is CommonJS. Node 24 resolves that on its
 *   own; Jest's CJS runtime does not, so it needs transpiling too.
 *
 * `libs/garage/contract/jest.config.cts` notes that a third project needing this
 * should move it into `jest.preset.js` rather than copy it again. That file is
 * outside the file set assigned to this task, so the lines are copied here and
 * the consolidation is flagged in the task report instead.
 *
 * The pattern itself is built by `jest.preset.js`'s `buildTransformIgnorePatterns`
 * rather than hand-rolled here — a plain `/node_modules/(?!(?:pkg)/)` regex
 * never matches under pnpm's nested `.pnpm/<name>@<version>/node_modules/<name>`
 * layout; see that function's doc comment.
 */
const { buildTransformIgnorePatterns } = require('../../../jest.preset.js');

module.exports = {
  displayName: 'api',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  // `*.db.spec.ts` needs a real PostgreSQL and belongs to `api:test-db`
  // (`jest.database.config.cts`). This target has to stay runnable without
  // Docker, and those tests refuse to skip themselves when it is missing.
  testPathIgnorePatterns: ['/node_modules/', '\\.db\\.spec\\.ts$'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.mjs$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  transformIgnorePatterns: [
    buildTransformIgnorePatterns(['@orpc', '@nestjs/config', '@nestjs/passport', 'jose']),
  ],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'html'],
  coverageDirectory: '../../../coverage/apps/garage/api',
};
