/**
 * `next-auth` and everything it pulls in (`@auth/core`, `jose`,
 * `oauth4webapi`, `@panva/hkdf`, `preact`) are published ESM-only —
 * `"type": "module"`, no `require` condition — while Jest runs here as
 * CommonJS. Same three lines as `libs/query/jest.config.cts`, described in
 * `doc/decision/0020-*`. `@orpc` is on the list too because
 * `access-token.spec.ts` drives a real `createApiClient` to prove the token
 * actually reaches the `Authorization` header.
 *
 * The pattern is built by `jest.preset.js`'s `buildTransformIgnorePatterns`
 * rather than hand-rolled here — a plain `/node_modules/(?!(?:pkg)/)` regex
 * never matches under pnpm's nested `.pnpm/<name>@<version>/node_modules/<name>`
 * layout; see that function's doc comment.
 */
const { buildTransformIgnorePatterns } = require('../../../jest.preset.js');
const esmOnlyPackages = ['next-auth', '@auth', 'jose', 'oauth4webapi', '@panva', 'preact', '@orpc'];

module.exports = {
  displayName: 'auth',
  preset: '../../../jest.preset.js',
  /**
   * `node`, not `jsdom`, is the default: most of this lib is server-side (the
   * `jwt`/`session`/`authorized` callbacks, the token refresher) and its tests
   * want Node's real `fetch`/`Response`, which jsdom does not implement
   * (`doc/decision/0037-*`). The one browser-side spec, `client.spec.tsx`,
   * opts into jsdom with a `@jest-environment jsdom` docblock — it stubs
   * `fetch` itself, so it needs no Web-API backfill.
   */
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  transform: {
    // The generated negative-lookahead pattern below is Jest's asset transform
    // (images, css, …), and Jest applies whichever `transform` pattern matches
    // *first*. `.mjs` is not in its extension list, so without adding it there
    // too, an `.mjs` file would match this rule before it ever reached the
    // babel-jest rule meant for it below.
    '^(?!.*\\.(js|jsx|ts|tsx|css|json|mjs)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
    '^.+\\.mjs$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  transformIgnorePatterns: [buildTransformIgnorePatterns(esmOnlyPackages)],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs'],
  coverageDirectory: '../../../coverage/libs/lets-park/auth',
};
