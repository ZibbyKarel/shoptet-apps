/**
 * Injects the authenticated caller into a handler parameter.
 *
 * ```ts
 * ‍@Get('me')
 * me(@CurrentUser() user: AuthenticatedUser) { … }
 * ```
 *
 * It **throws** rather than returning `undefined` when there is no caller. A
 * handler asking for `@CurrentUser()` has declared that it needs one, and the
 * only ways to reach it without one are a `@Public()` route or a change to the
 * global guard order — both defects, and both far cheaper to find as a 500 in
 * a test than as `user.id` reading `undefined` three layers down.
 */

import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user';
import { isAuthenticatedUser, REQUEST_USER_PROPERTY } from './authenticated-user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as Record<string, unknown>)[REQUEST_USER_PROPERTY];

    if (!isAuthenticatedUser(user)) {
      throw new Error('@CurrentUser() was used on a route that is not behind JwtAuthGuard.');
    }

    return user;
  }
);
