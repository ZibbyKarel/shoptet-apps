/**
 * The single `NextAuth()` call.
 *
 * There is not much logic here to test — the rules live in `config.ts` — but
 * two properties are worth pinning, because both would fail silently: that the
 * instance actually constructs against the installed Auth.js (a v4 idiom would
 * throw or hand back a different shape), and that it reads nothing from the
 * environment behind `apps/garage/web/src/env.ts`'s back.
 */

import { createAuth } from './create-auth';
import { createAuthConfig } from './config';
import type { AuthOptions } from './config';

const OPTIONS: AuthOptions = {
  issuer: 'https://example.okta.test/oauth2/default',
  clientId: 'garage-web',
  clientSecret: 'super-secret',
  secret: 'a'.repeat(32),
};

/** Every variable Auth.js would otherwise infer for itself. */
const INFERRED_VARIABLES = [
  'AUTH_SECRET',
  'AUTH_URL',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'AUTH_OKTA_ID',
  'AUTH_OKTA_SECRET',
  'AUTH_OKTA_ISSUER',
];

/**
 * The four variables whose presence would otherwise make `trustHost` true, plus
 * `NODE_ENV`. Removing all of them and setting `NODE_ENV=production` reproduces
 * the deployment `apps/garage/web` will actually run in (Task 29): a container behind
 * a reverse proxy, on none of the hosting platforms Auth.js special-cases.
 */
const TRUST_HOST_VARIABLES = ['AUTH_URL', 'NEXTAUTH_URL', 'AUTH_TRUST_HOST', 'VERCEL', 'CF_PAGES'];

/**
 * Runs `body` with the environment a production container has: `NODE_ENV`
 * production and every `trustHost`-granting variable absent.
 */
async function inProductionEnvironment(body: () => Promise<void>): Promise<void> {
  const names = [...TRUST_HOST_VARIABLES, 'NODE_ENV'];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  // `@types/node` marks `NODE_ENV` readonly to discourage writing it in shipped
  // code, which is right — but the whole point here is to stand in the shoes of
  // a production container, and Auth.js reads it from `process.env` at
  // construction time, so there is no other way in. Restored in `finally`.
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const name of TRUST_HOST_VARIABLES) delete mutableEnv[name];
  mutableEnv['NODE_ENV'] = 'production';

  try {
    await body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete mutableEnv[name];
      else mutableEnv[name] = value;
    }
  }
}

describe('createAuth', () => {
  it('produces the App Router surface: handlers, auth, signIn, signOut', () => {
    const auth = createAuth(OPTIONS);

    // `handlers` is `{ GET, POST }` in v5 — the shape
    // `app/api/auth/[...nextauth]/route.ts` re-exports.
    expect(typeof auth.handlers.GET).toBe('function');
    expect(typeof auth.handlers.POST).toBe('function');
    expect(typeof auth.auth).toBe('function');
    expect(typeof auth.signIn).toBe('function');
    expect(typeof auth.signOut).toBe('function');
  });

  it('exposes an access token provider for @garage/api-client', () => {
    expect(typeof createAuth(OPTIONS).getAccessToken).toBe('function');
  });

  it('constructs with every Auth.js environment variable removed', () => {
    // Auth.js infers `AUTH_SECRET`, `AUTH_OKTA_ID`/`_SECRET` and friends from
    // the environment when they are present. This lib passes everything
    // explicitly instead, so that `apps/garage/web/src/env.ts` stays the one schema
    // that decides which variables exist — and so that no value can be picked
    // up implicitly in one environment and missing in another.
    const saved = new Map(INFERRED_VARIABLES.map((name) => [name, process.env[name]]));
    for (const name of INFERRED_VARIABLES) delete process.env[name];

    try {
      expect(() => createAuth(OPTIONS)).not.toThrow();
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('serves /api/auth/session in a production container instead of refusing the host', async () => {
    // The regression this guards: Auth.js computes `trustHost` from
    // `AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? CF_PAGES ?? NODE_ENV !== 'production'`
    // (`@auth/core/lib/utils/env.js`) and, when it is false, `assertConfig`
    // returns `UntrustedHost` and **every** `/api/auth/*` request 500s with
    // "Host must be trusted" (`@auth/core/lib/utils/assert.js`). None of the
    // first four is set in this project's deployment, so without an explicit
    // `trustHost` the failure appears in production and *only* there — dev and
    // e2e stay green because `NODE_ENV !== 'production'`.
    //
    // This drives the real route handler rather than reading the config field,
    // so it fails the same way a browser would.
    await inProductionEnvironment(async () => {
      const { handlers } = createAuth(OPTIONS);

      // `handlers.GET` is typed for a `NextRequest`, but next-auth only passes
      // it through to `@auth/core`'s `Auth()`, which reads the standard
      // `Request` surface. `reqWithEnvURL` touches `nextUrl` only when
      // `AUTH_URL`/`NEXTAUTH_URL` is set, and this environment has neither.
      const request = new Request('https://garage.example/api/auth/session');
      const response = await handlers.GET(request as never);

      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain('Host must be trusted');
    });
  });
});

describe('createAuthConfig, trustHost', () => {
  it('states trustHost rather than letting the environment decide', () => {
    expect(createAuthConfig(OPTIONS).trustHost).toBe(true);
  });

  it('can still be turned off explicitly', () => {
    expect(createAuthConfig({ ...OPTIONS, trustHost: false }).trustHost).toBe(false);
  });
});
