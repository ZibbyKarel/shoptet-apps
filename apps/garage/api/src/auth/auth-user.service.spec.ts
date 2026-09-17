/**
 * JIT provisioning.
 *
 * The store underneath is in-memory but enforces the three unique constraints
 * the schema declares, and yields between read and write, so the concurrency
 * test below reproduces a real interleaving rather than asserting one. See
 * `testing/in-memory-user-store.ts` for what that does and does not prove.
 */

import { UnauthorizedException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { DomainError } from '../common/errors/domain-error';
import type { PrismaService } from '../database/prisma.service';
import { AuthUserService, generateIcsToken, ICS_TOKEN_BYTES } from './auth-user.service';
import { InMemoryUserStore } from './testing/in-memory-user-store';
import type { UserSeed } from './testing/in-memory-user-store';

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger;

function build(seeds: UserSeed[] = []): { service: AuthUserService; store: InMemoryUserStore } {
  const store = new InMemoryUserStore(seeds);
  const service = new AuthUserService(
    store.asPrismaService() as unknown as PrismaService,
    silentLogger
  );
  return { service, store };
}

describe('AuthUserService', () => {
  describe('generateIcsToken', () => {
    it('is base64url and carries the full entropy', () => {
      const token = generateIcsToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(ICS_TOKEN_BYTES);
    });

    it('does not repeat', () => {
      const tokens = new Set(Array.from({ length: 200 }, () => generateIcsToken()));

      expect(tokens.size).toBe(200);
    });
  });

  describe('an unknown subject', () => {
    it('provisions a user with an icsToken', async () => {
      const { service, store } = build();

      const user = await service.resolve({
        sub: 'okta-1',
        email: 'alice@example.com',
        name: 'Alice',
      });

      expect(user).toMatchObject({
        oktaId: 'okta-1',
        email: 'alice@example.com',
        name: 'Alice',
        role: 'USER',
        active: true,
      });
      const [row] = store.all();
      expect(row?.icsToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    });

    it('falls back to the email when the token carries no name', async () => {
      const { service } = build();

      const user = await service.resolve({ sub: 'okta-1', email: 'alice@example.com' });

      // `userSchema` forbids an empty name, so an absent claim must not become
      // one.
      expect(user.name).toBe('alice@example.com');
    });

    it('refuses to provision when the token carries no email', async () => {
      const { service, store } = build();

      await expect(service.resolve({ sub: 'okta-1', name: 'Alice' })).rejects.toBeInstanceOf(
        UnauthorizedException
      );
      expect(store.all()).toHaveLength(0);
    });

    it('never hands out the icsToken to the caller', async () => {
      const { service } = build();

      const user = await service.resolve({ sub: 'okta-1', email: 'alice@example.com' });

      expect(Object.keys(user)).toEqual(['id', 'oktaId', 'email', 'name', 'role', 'active']);
    });
  });

  describe('a known subject', () => {
    it('matches on oktaId and creates nothing', async () => {
      const { service, store } = build([
        { oktaId: 'okta-1', email: 'alice@example.com', name: 'Alice', role: 'ADMIN' },
      ]);

      const user = await service.resolve({
        sub: 'okta-1',
        email: 'alice@example.com',
        name: 'Alice',
      });

      expect(user.role).toBe('ADMIN');
      expect(store.createCount).toBe(0);
      expect(store.all()).toHaveLength(1);
    });

    it('matches on oktaId even when the email claim differs', async () => {
      const { service, store } = build([
        { oktaId: 'okta-1', email: 'alice@example.com', name: 'Alice' },
      ]);

      const user = await service.resolve({
        sub: 'okta-1',
        email: 'alice.new@example.com',
        name: 'Alice',
      });

      // The subject is the identity; the address is not refreshed from a claim.
      expect(user.email).toBe('alice@example.com');
      expect(store.createCount).toBe(0);
    });

    it('propagates a changed display name', async () => {
      const { service, store } = build([
        { oktaId: 'okta-1', email: 'alice@example.com', name: 'Alice Old' },
      ]);

      const user = await service.resolve({
        sub: 'okta-1',
        email: 'alice@example.com',
        name: 'Alice New',
      });

      expect(user.name).toBe('Alice New');
      expect(store.all()[0]?.name).toBe('Alice New');
    });
  });

  describe('the email fallback', () => {
    it('adopts the token subject onto a row seeded with a different oktaId', async () => {
      const { service, store } = build([
        { oktaId: 'placeholder', email: 'alice@example.com', name: 'Alice', role: 'ADMIN' },
      ]);

      const user = await service.resolve({
        sub: 'okta-new',
        email: 'alice@example.com',
        name: 'Alice',
      });

      expect(user.oktaId).toBe('okta-new');
      expect(user.role).toBe('ADMIN');
      expect(store.createCount).toBe(0);
      expect(store.all()).toHaveLength(1);
    });
  });

  describe('a deactivated user', () => {
    it('is refused with the contract FORBIDDEN code, not a 401', async () => {
      const { service } = build([
        { oktaId: 'okta-1', email: 'alice@example.com', name: 'Alice', active: false },
      ]);

      // The distinction matters: 401 would send the browser back round the Okta
      // login loop forever, because the token is perfectly valid.
      const error = await service
        .resolve({ sub: 'okta-1', email: 'alice@example.com' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    });

    it('is refused immediately after being provisioned and then deactivated', async () => {
      const { service, store } = build();
      await service.resolve({ sub: 'okta-1', email: 'alice@example.com' });
      const [row] = store.all();
      if (row !== undefined) {
        row.active = false;
      }

      await expect(
        service.resolve({ sub: 'okta-1', email: 'alice@example.com' })
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe('concurrent first requests', () => {
    it('creates exactly one user when eight requests arrive together', async () => {
      const { service, store } = build();

      const users = await Promise.all(
        Array.from({ length: 8 }, () =>
          service.resolve({ sub: 'okta-1', email: 'alice@example.com', name: 'Alice' })
        )
      );

      expect(store.createCount).toBe(1);
      expect(store.all()).toHaveLength(1);
      // Every caller got the same row, not seven failures and one success.
      expect(new Set(users.map((user) => user.id)).size).toBe(1);
    });

    it('creates one user per distinct subject when different people arrive together', async () => {
      const { service, store } = build();

      await Promise.all([
        service.resolve({ sub: 'okta-1', email: 'alice@example.com' }),
        service.resolve({ sub: 'okta-2', email: 'bob@example.com' }),
        service.resolve({ sub: 'okta-1', email: 'alice@example.com' }),
        service.resolve({ sub: 'okta-2', email: 'bob@example.com' }),
      ]);

      expect(store.createCount).toBe(2);
      expect(
        store
          .all()
          .map((row) => row.oktaId)
          .sort()
      ).toEqual(['okta-1', 'okta-2']);
    });
  });
});
