/**
 * The default guard for the whole API.
 *
 * Registered as an `APP_GUARD` in `AppModule`, so a route is authenticated
 * unless it says otherwise with `@Public()`. It adds exactly one thing to
 * Nest's `AuthGuard('jwt')`: the `@Public()` check. Everything else — token
 * extraction, JWKS lookup, signature/issuer/audience/expiry verification, JIT
 * provisioning — happens in `JwtStrategy` and the services it delegates to.
 *
 * `handleRequest` is deliberately **not** overridden. Its default behaviour is
 * what produces the two documented outcomes: rethrow whatever `validate()`
 * threw (so a deactivated user's `DomainError('FORBIDDEN')` reaches
 * `ContractExceptionFilter` and comes out as the contract's 403), and turn a
 * Passport `fail()` into `UnauthorizedException` (401). Overriding it to
 * "improve" the message is how that distinction gets lost.
 *
 * ## Why `@nestjs/passport` is pinned to an exact version
 *
 * That 403 is **not** a property of any code in this repository. It depends on
 * `@nestjs/passport`'s `PassportStrategy` mixin catching a rejected
 * `validate()` and calling `done(err)` — Passport's `error()` leg — rather than
 * `fail()`. If a release ever routed it through `fail()` instead, every
 * deactivated user would start getting 401 and looping through Okta forever.
 * Nothing would fail to compile.
 *
 * `package.json` therefore pins `"@nestjs/passport": "12.0.0"` exactly, not
 * `^12.0.0`, so that behaviour change can only arrive as a deliberate upgrade.
 * When upgrading it, run `auth-pipeline.spec.ts` first — its
 * "gets 403 with the contract FORBIDDEN body, not 401" case is what actually
 * checks this, and it is known to fail when the behaviour flips (verified by
 * mutation). See `doc/decision/0041-*`.
 */

import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Observable } from 'rxjs';
import { JWT_STRATEGY_NAME } from './jwt.strategy';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard(JWT_STRATEGY_NAME) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(
    context: ExecutionContext
  ): boolean | Promise<boolean> | Observable<boolean> {
    // `getAllAndOverride` so `@Public()` works on a controller as well as on a
    // single handler, with the handler winning.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }
    return super.canActivate(context);
  }
}
