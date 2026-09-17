/**
 * The database-contract suite: the `*.db.spec.ts` files, which need a real
 * PostgreSQL and are excluded from `api:test` for that reason.
 *
 * Same transform setup as `jest.config.cts` — see its header for why four
 * dependencies have to be transpiled — differing only in which files are
 * collected. Run with `nx run api:test-db` after
 * `docker compose --profile dev up -d`.
 *
 * `globalSetup` creates a throwaway database for the run and repoints
 * `DATABASE_URL` at it, so the developer's seeded `garage` is never written
 * to; `globalTeardown` drops it. Task 13 needs this because its concurrency
 * tests have to **commit** to race at all, and a committed `AuditLog` row can
 * never be deleted again. See `src/testing/database/test-database.ts`.
 *
 * `maxWorkers: 1` for the same reason `--runInBand` is on the target: the specs
 * create their own concurrency deliberately, and workers racing each other on
 * top of that would make a failure impossible to attribute.
 *
 * `testTimeout: 20_000`: `waitForBlockedBackend` (see
 * `src/testing/database/reservation-harness.ts`) defaults to a 10s deadline
 * before it throws its own diagnostic ("No backend ever blocked on a lock …").
 * Jest's own default `testTimeout` is 5s, which is *below* that deadline, so a
 * test that never blocks dies on Jest's generic "exceeded timeout … add a
 * timeout value to increase the timeout" — advice that points at exactly the
 * wrong fix — instead of on the guard's own message. 20s leaves headroom above
 * the guard's 10s so its diagnostic is always the one that fires.
 */
const { buildTransformIgnorePatterns } = require('../../../jest.preset.js');

module.exports = {
  displayName: 'api-db',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.db.spec.ts'],
  globalSetup: '<rootDir>/src/testing/database/global-setup.ts',
  globalTeardown: '<rootDir>/src/testing/database/global-teardown.ts',
  maxWorkers: 1,
  testTimeout: 20_000,
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.mjs$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  transformIgnorePatterns: [
    buildTransformIgnorePatterns(['@orpc', '@nestjs/config', '@nestjs/passport', 'jose']),
  ],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'html'],
  coverageDirectory: '../../../coverage/apps/garage/api-db',
};
