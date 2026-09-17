/**
 * Authentication through the **assembled** application, driven with real HTTP.
 *
 * This file exists for the reason `app/http-pipeline.spec.ts` exists: the
 * claims worth making about auth are properties of a composition — Express →
 * `ThrottlerGuard` → `JwtAuthGuard` → Passport → `passport-jwt` →
 * `jsonwebtoken` → `RolesGuard` → `ContractExceptionFilter` — and no unit test
 * that calls a guard directly can see them. Two in particular would pass a unit
 * test while being wrong in production:
 *
 * - **A deactivated user must get 403 with the contract body, not 401.** That
 *   depends on which of Passport's two legs (`fail` vs `error`) a thrown
 *   `DomainError` travels, which is decided by `@nestjs/passport`'s mixin and
 *   Nest's `AuthGuard.handleRequest`, not by anything in this repository.
 * - **Issuer and audience must actually be checked.** `passport-jwt` overwrites
 *   those options from its top-level keys, so a plausible-looking configuration
 *   can silently disable both. Only a wrong-issuer token proves otherwise.
 *
 * The module under test is the real `AppModule`, so the guard *order* and the
 * `@Public()` opt-out are exercised as configured, not as re-declared here. The
 * database is an in-memory stand-in that enforces the unique constraints
 * (Docker is unavailable in this environment); the issuer is a real in-process
 * OIDC server publishing real RSA keys, standing in for `mock-oauth2-server`
 * at the same two endpoints. Nothing in `src/auth` knows either of them exists.
 */

import { Controller, Get } from '@nestjs/common';
import type { ApiTestApp } from '../testing/nest-test-app';
import { AUDIENCE, startApiTestApp } from '../testing/nest-test-app';
import type { AuthenticatedUser } from './authenticated-user';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';
import { InMemoryUserStore } from './testing/in-memory-user-store';
import type { OidcTestIssuer, TestSigningKey } from './testing/oidc-test-issuer';
import { createSigningKey, startOidcTestIssuer } from './testing/oidc-test-issuer';
import { forgeUnsignedToken, signTestToken } from './testing/sign-test-token';

/** A route with no decorator at all: protected purely by the global default. */
@Controller('protected')
class ProtectedController {
  @Get()
  whoami(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}

@Controller('admin-only')
class AdminController {
  @Roles('ADMIN')
  @Get()
  secret(): { ok: true } {
    return { ok: true };
  }
}

@Controller('open')
class OpenController {
  @Public()
  @Get()
  anyone(): { ok: true } {
    return { ok: true };
  }
}

describe('authentication through the assembled application', () => {
  let harness: ApiTestApp;
  let issuer: OidcTestIssuer;
  let signingKey: TestSigningKey;
  let store: InMemoryUserStore;
  const originalEnv = { ...process.env };

  /** A token this API should accept, unless an option is deliberately wrong. */
  function tokenFor(
    overrides: Partial<Parameters<typeof signTestToken>[0]> & { subject: string }
  ): string {
    return signTestToken({
      key: signingKey,
      issuer: issuer.issuer,
      audience: AUDIENCE,
      ...overrides,
    });
  }

  function get(path: string, token?: string): Promise<Response> {
    return fetch(`${harness.baseUrl}${path}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
  }

  beforeAll(async () => {
    signingKey = createSigningKey('key-1');
    issuer = await startOidcTestIssuer([signingKey]);

    store = new InMemoryUserStore([
      { oktaId: 'okta-admin', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
      { oktaId: 'okta-user', email: 'user@example.com', name: 'User' },
      {
        oktaId: 'okta-gone',
        email: 'gone@example.com',
        name: 'Former Employee',
        active: false,
      },
    ]);

    // The three probe routes are compiled alongside the real `AppModule`, so the
    // global guards apply to them exactly as configured. The environment — and
    // in particular the fact that `AUTH_OKTA_ISSUER` is the only value that
    // differs from production, which is the entire point of the "no test branch
    // in auth" rule — is `testing/nest-test-app.ts`.
    harness = await startApiTestApp({
      issuer,
      store,
      controllers: [ProtectedController, AdminController, OpenController],
    });
  });

  afterAll(async () => {
    await harness?.close();
    await issuer?.close();
    process.env = originalEnv;
  });

  describe('a valid token', () => {
    it('is accepted and identifies the caller', async () => {
      const response = await get('/api/protected', tokenFor({ subject: 'okta-user' }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        oktaId: 'okta-user',
        email: 'user@example.com',
        role: 'USER',
        active: true,
      });
    });

    it('never returns the icsToken with the caller', async () => {
      const response = await get('/api/protected', tokenFor({ subject: 'okta-user' }));

      expect(await response.text()).not.toContain('icsToken');
    });
  });

  describe('rejections, all of which must be 401 with the transport shape', () => {
    it.each([
      ['no Authorization header', () => undefined],
      [
        'a token signed by an unpublished key',
        () =>
          signTestToken({
            key: { ...createSigningKey('impostor'), kid: signingKey.kid },
            issuer: issuer.issuer,
            audience: AUDIENCE,
            subject: 'okta-user',
          }),
      ],
      ['an expired token', () => tokenFor({ subject: 'okta-user', expiresInSeconds: -60 })],
      [
        'a token from another issuer',
        () =>
          signTestToken({
            key: signingKey,
            issuer: 'https://evil.example/oauth2',
            audience: AUDIENCE,
            subject: 'okta-user',
          }),
      ],
      [
        'a token for another audience',
        () =>
          signTestToken({
            key: signingKey,
            issuer: issuer.issuer,
            audience: 'api://someone-else',
            subject: 'okta-user',
          }),
      ],
      [
        'an unsigned token claiming alg: none',
        () =>
          forgeUnsignedToken({
            sub: 'okta-admin',
            iss: issuer.issuer,
            aud: AUDIENCE,
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
      ],
      ['a token with an unknown kid', () => tokenFor({ subject: 'okta-user', kid: 'no-such' })],
      ['a bearer value that is not a JWT', () => 'garbage'],
    ])('refuses %s', async (_name, mint) => {
      const response = await get('/api/protected', mint());
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(401);
      // The closed contract enum has no member for "not authenticated" — this
      // is a pre-domain failure and keeps Nest's shape (decision 0033/0041).
      expect(body).toMatchObject({ statusCode: 401 });
      expect(body).not.toHaveProperty('code');
    });

    it('does not leak the token or a stack trace in the response', async () => {
      const token = tokenFor({ subject: 'okta-user', expiresInSeconds: -60 });

      const raw = await get('/api/protected', token).then((response) => response.text());

      expect(raw).not.toContain(token);
      expect(raw).not.toContain('jwks');
      expect(raw).not.toMatch(/\bat .*\.ts:\d+/);
    });
  });

  describe('a deactivated user', () => {
    it('gets 403 with the contract FORBIDDEN body, not 401', async () => {
      const response = await get('/api/protected', tokenFor({ subject: 'okta-gone' }));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        defined: false,
        code: 'FORBIDDEN',
        status: 403,
        message: 'The caller is not allowed to perform this action.',
      });
    });
  });

  describe('just-in-time provisioning', () => {
    it('creates a user on their first ever request', async () => {
      const before = store.createCount;

      const response = await get(
        '/api/protected',
        tokenFor({ subject: 'okta-new', email: 'new@example.com', name: 'New Person' })
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        oktaId: 'okta-new',
        email: 'new@example.com',
        name: 'New Person',
        role: 'USER',
      });
      expect(store.createCount).toBe(before + 1);
    });

    it('creates exactly one user when the first requests arrive together', async () => {
      const before = store.createCount;
      const token = tokenFor({
        subject: 'okta-burst',
        email: 'burst@example.com',
        name: 'Burst',
      });

      // Without this the test is worthless: over real HTTP the first request
      // finishes provisioning before the second has even read, so no race
      // occurs and the assertion holds however the code is written. A mutation
      // test proved exactly that — deleting the P2002 retry left this green.
      // Holding the insert open puts all six requests inside `create` at once.
      store.createDelayMs = 25;
      try {
        const responses = await Promise.all(
          Array.from({ length: 6 }, () => get('/api/protected', token))
        );

        expect(responses.map((response) => response.status)).toEqual([
          200, 200, 200, 200, 200, 200,
        ]);
      } finally {
        store.createDelayMs = 0;
      }

      expect(store.createCount).toBe(before + 1);
      expect(store.all().filter((row) => row.oktaId === 'okta-burst')).toHaveLength(1);
    });
  });

  describe('the role guard', () => {
    it('lets an ADMIN through', async () => {
      const response = await get('/api/admin-only', tokenFor({ subject: 'okta-admin' }));

      expect(response.status).toBe(200);
    });

    it('refuses a USER with the contract FORBIDDEN body', async () => {
      const response = await get('/api/admin-only', tokenFor({ subject: 'okta-user' }));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    });

    it('refuses an anonymous caller at the auth guard, before the role guard', async () => {
      const response = await get('/api/admin-only');

      expect(response.status).toBe(401);
    });
  });

  describe('the default is deny', () => {
    it('protects a route that carries no auth decorator at all', async () => {
      // `ProtectedController` carries no auth decorator of any kind; it is
      // protected because `JwtAuthGuard` is an APP_GUARD. This used to probe
      // `GET /api`, the Nx scaffold's `AppController`, which was deleted as a
      // route in no contract (`doc/decision/0239-*`) — a locally declared
      // controller makes the same point without depending on a stub existing.
      const response = await get('/api/protected');

      expect(response.status).toBe(401);
    });

    it('answers 404 at the bare /api prefix — nothing is mounted there', async () => {
      // The scaffold route's replacement assertion. `AppModule` registers no
      // controller of its own any more, so the prefix itself is not a route.
      const response = await get('/api');

      expect(response.status).toBe(404);
    });

    it('lets a @Public() route through with no token', async () => {
      const response = await get('/api/open');

      expect(response.status).toBe(200);
    });

    it('keeps the probes reachable without a token', async () => {
      await expect(get('/health/live').then((response) => response.status)).resolves.toBe(200);
      await expect(get('/health/ready').then((response) => response.status)).resolves.toBe(200);
    });
  });
});
