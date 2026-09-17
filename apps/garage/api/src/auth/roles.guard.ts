/**
 * Authorization, once authentication has already happened.
 *
 * Registered as an `APP_GUARD` **after** `JwtAuthGuard`, because Nest runs
 * global guards in registration order and this one reads the `request.user`
 * that the previous one put there.
 *
 * Two rules, both of which fail closed:
 *
 * - a route with no `@Roles()` metadata is allowed — this guard's job is to
 *   enforce a declared restriction, not to invent one;
 * - a route *with* `@Roles()` but no authenticated caller is refused. That
 *   combination means `@Public()` and `@Roles()` were put on the same handler,
 *   or the guard order was changed; either way, guessing would be the wrong
 *   response.
 *
 * A caller who is authenticated but lacks the role gets the contract's
 * `FORBIDDEN` (403), the same code and body a deactivated user gets, because
 * from the client's side they are the same situation: correctly identified,
 * not allowed.
 */

import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@garage/contract';
import { DomainError } from '../common/errors/domain-error';
import { isAuthenticatedUser, REQUEST_USER_PROPERTY } from './authenticated-user';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as Record<string, unknown>)[REQUEST_USER_PROPERTY];

    if (!isAuthenticatedUser(user)) {
      throw new UnauthorizedException();
    }

    if (!required.includes(user.role)) {
      throw new DomainError('FORBIDDEN', {
        message: `The role ${user.role} may not use this route.`,
      });
    }

    return true;
  }
}
