/**
 * The server half must stay out of the client entry point's module graph.
 *
 * `@garage/auth/client` is meant to reach `next-auth/react` and nothing
 * else; `@garage/auth` is what reaches Auth.js's server runtime (route
 * handlers, `next/server`, the OAuth machinery). Keeping them apart is the
 * whole reason there are two entry points (`doc/decision/0046-*`), and it is
 * the kind of property that breaks silently: one `import { X } from './config'`
 * added for a constant drags the provider and the token refresher across, and
 * nothing fails until the app is bundled.
 *
 * The guard is coupled to the real thing rather than to a regex over source
 * text: a factory below runs **only if** the client entry point actually
 * requires the module it stands for, so the suite fails at import time when
 * the boundary is crossed. Confirmed by probe — `client.tsx` was temporarily
 * given a real `import { OKTA_SCOPES } from './config'` (re-exported, so babel
 * could not elide it) and this file failed with:
 *
 *     @garage/auth/client reached "./config" — the server half.
 *       at Object.require (src/lib/client.tsx:21:1)
 *       at Object.require (src/client/index.ts:13:1)
 *
 * One limitation, also found by probing: babel drops an imported binding that
 * is never used, so an unused import does not trip this. That is the right
 * behaviour — an unused import is not in the bundle either — but it means the
 * guard watches the *runtime* graph, not the source text.
 */

/*
 * Every module that belongs to the server half, one `jest.mock` each. The
 * factories are spelled out rather than generated in a loop because
 * `babel-plugin-jest-hoist` hoists `jest.mock` calls above the imports and
 * refuses a factory that closes over anything.
 *
 * `next-auth` alone is not enough, and this was found by running it: an
 * `import { OKTA_SCOPES } from './config'` added to `client.tsx` as a probe
 * left this file **passing**, because `config.ts` reaches
 * `next-auth/providers/okta` and takes the rest as types, never requiring the
 * bare server entry. A tripwire watching only `next-auth` would have been a
 * tripwire coupled to nothing.
 */
import * as clientEntry from '../client';

/*
 * The `jest.mock` calls sit *below* the import above, which reads backwards but
 * is correct: `babel-plugin-jest-hoist` lifts them above every generated
 * `require`, so they are registered before `../client` is loaded. Writing them
 * first would satisfy intuition and fail `import/first`.
 *
 * The message is repeated rather than factored into a constant: a hoisted
 * factory that reads a `const` declared below it would blow up with a
 * temporal-dead-zone `ReferenceError` instead of the explanation, exactly when
 * the explanation is wanted.
 */
jest.mock('next-auth', () => {
  throw new Error(
    '@garage/auth/client reached "next-auth" — the server half. See doc/decision/0046-*.'
  );
});
jest.mock('next-auth/providers/okta', () => {
  throw new Error(
    '@garage/auth/client reached "next-auth/providers/okta" — the server half. See doc/decision/0046-*.'
  );
});
jest.mock('./config', () => {
  throw new Error(
    '@garage/auth/client reached "./config" — the server half. Move what it needed into src/lib/session.ts. See doc/decision/0046-*.'
  );
});
jest.mock('./create-auth', () => {
  throw new Error(
    '@garage/auth/client reached "./create-auth" — the server half. See doc/decision/0046-*.'
  );
});

describe('@garage/auth/client', () => {
  it("loads without requiring next-auth's server entry", () => {
    // Reaching this line at all is the assertion: the mock factory above throws
    // if `next-auth` was required while importing the client entry point.
    expect(typeof clientEntry.AuthProvider).toBe('function');
    expect(typeof clientEntry.useRequireAuth).toBe('function');
    expect(typeof clientEntry.useAccessTokenProvider).toBe('function');
  });

  it('still exposes the shared vocabulary both halves need', () => {
    expect(clientEntry.REFRESH_TOKEN_ERROR).toBe('RefreshTokenError');
    expect(clientEntry.OKTA_PROVIDER_ID).toBe('okta');
  });
});
