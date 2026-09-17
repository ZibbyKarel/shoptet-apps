/**
 * `RolesGuard` in isolation.
 *
 * The happy paths (an ADMIN allowed, a USER refused) are asserted end to end in
 * `auth-pipeline.spec.ts`, through the real decorator and the real guard chain.
 * What is left for a unit test is the two branches a route cannot easily reach
 * from outside: an undecorated route, and a decorated route with no
 * authenticated caller — the "`@Public()` and `@Roles()` on the same handler"
 * mistake, which must deny rather than throw a confusing `undefined`.
 */

import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@garage/contract';
import { DomainError } from '../common/errors/domain-error';
import type { AuthenticatedUser } from './authenticated-user';
import { RolesGuard } from './roles.guard';

const ADMIN: AuthenticatedUser = {
  id: '0193d4f0-0000-7000-8000-000000000001',
  oktaId: 'okta-admin',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN',
  active: true,
};

const USER: AuthenticatedUser = { ...ADMIN, oktaId: 'okta-user', role: 'USER' };

/**
 * Stand-ins for the handler and controller the reflector would read metadata
 * from. Their bodies are irrelevant — the reflector is stubbed too — but they
 * must be distinct references, because `getAllAndOverride` is called with both.
 */
function handlerStub(): void {
  return undefined;
}
class ControllerStub {}

function contextWith(user: unknown): ExecutionContext {
  return {
    getHandler: () => handlerStub,
    getClass: () => ControllerStub,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: readonly UserRole[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: () => roles,
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows a route that declares no roles', () => {
    expect(guardRequiring(undefined).canActivate(contextWith(USER))).toBe(true);
  });

  it('allows a route whose role list is empty', () => {
    // `@Roles()` with no arguments restricts nothing; it must not lock everyone
    // out by matching no role.
    expect(guardRequiring([]).canActivate(contextWith(USER))).toBe(true);
  });

  it('allows a caller holding the required role', () => {
    expect(guardRequiring(['ADMIN']).canActivate(contextWith(ADMIN))).toBe(true);
  });

  it('refuses a caller without it, as a contract FORBIDDEN', () => {
    const guard = guardRequiring(['ADMIN']);

    const error = (() => {
      try {
        guard.canActivate(contextWith(USER));
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it.each([
    ['no user at all', undefined],
    ['a user-shaped object with the wrong types', { id: 1, role: 'ADMIN' }],
  ])('fails closed when the request carries %s', (_name, user) => {
    expect(() => guardRequiring(['ADMIN']).canActivate(contextWith(user))).toThrow(
      UnauthorizedException
    );
  });
});
