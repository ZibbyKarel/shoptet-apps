/**
 * No ESM-transform block here, and that is a finding rather than an omission.
 *
 * The block that `doc/decision/0020-*` describes (and that `libs/garage/contract`,
 * `libs/garage/database`, `apps/garage/api`, `libs/shared/i18n`, `libs/query`, `libs/shared/api-client` and
 * `libs/garage/auth` all carry) exists for packages published ESM-only. Nothing on
 * this lib's runtime path is one: `socket.io-client` 4.8.3 is `"type":
 * "commonjs"` with both `require` and `import` conditions, `zod` is dual, and
 * `@garage/contract/realtime` is deliberately free of `@orpc` — that is
 * what `libs/garage/contract/src/realtime/no-orpc.spec.ts` enforces, and this Jest
 * config is a second, independent consequence of it. The one `@orpc`-adjacent
 * import in this lib, `AccessTokenProvider` from `@garage/api-client`, is
 * an `import type` and is erased before Jest ever sees it.
 *
 * `jsdom`, not `node`: every export here is a React hook.
 */
module.exports = {
  displayName: 'realtime-client',
  preset: '../../../jest.preset.js',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../../coverage/libs/garage/realtime-client',
};
