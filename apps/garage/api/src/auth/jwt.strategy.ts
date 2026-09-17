/**
 * The `passport-jwt` strategy: bearer token in, `AuthenticatedUser` out.
 *
 * It owns very little. Key lookup is `JwksVerifierService`'s, the verification
 * rules are `jwtVerifyOptions`', and turning claims into a user is
 * `AuthUserService`'s. What is left here is the plumbing Passport needs:
 * where to find the token, which key to check it with, and what to do once it
 * has verified.
 *
 * ## How a failure becomes a status code
 *
 * `passport-jwt` distinguishes two outcomes, and Nest's `AuthGuard` maps them
 * differently. This is the whole reason the deactivated-user case comes out as
 * a 403 rather than a 401:
 *
 * - **`fail(info)`** — no token, bad signature, expired, wrong issuer, wrong
 *   audience. Nest sees `user === false` and throws `UnauthorizedException`
 *   → `401 { statusCode, message }` (a transport error, per
 *   `doc/decision/0033-*`).
 * - **`error(err)`** — the verify callback threw. `@nestjs/passport`'s mixin
 *   catches a rejected `validate()` and calls `done(err)`, so anything thrown
 *   below travels this leg. Nest rethrows it unchanged, and
 *   `ContractExceptionFilter` renders it: a `DomainError('FORBIDDEN')` becomes
 *   `403 { defined: false, code: 'FORBIDDEN', … }`.
 *
 * `auth-pipeline.spec.ts` asserts both bodies against a running server, because
 * this distinction is a property of three libraries composed, not of any line
 * of code here.
 */

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from './authenticated-user';
import { AuthUserService } from './auth-user.service';
import { JwksVerifierService } from './jwks-verifier.service';
import { authTokenClaimsSchema } from './token-claims';

/** The Passport strategy name. Referenced by `JwtAuthGuard`, nowhere else. */
export const JWT_STRATEGY_NAME = 'jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY_NAME) {
  constructor(
    verifier: JwksVerifierService,
    private readonly users: AuthUserService
  ) {
    super({
      // Bearer only. Never a query parameter and never a cookie: a token in a
      // URL ends up in access logs, referrers and browser history.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      // The one JWKS client in the process, not a second one built by
      // `jwksRsa.passportJwtSecret()` — see `doc/decision/0042-*`.
      secretOrKeyProvider: (_request, rawJwtToken: string, done) => {
        verifier.getSigningKey(rawJwtToken).then(
          (key) => {
            done(null, key);
          },
          (error: unknown) => {
            done(error instanceof Error ? error : new Error('Signing key lookup failed.'));
          }
        );
      },

      // The verifier's own rules object — not a second one built from the same
      // env, which could drift. Spread at the **top level** deliberately:
      // `passport-jwt` overwrites `issuer`/`audience`/`algorithms`/
      // `ignoreExpiration` from its top-level options, with `undefined` when
      // they are absent, so passing these only as `jsonWebTokenOptions` would
      // quietly switch issuer and audience checking off. See the comment in
      // `jwt-verify-options.ts`.
      ...verifier.options,
    });
  }

  /**
   * Runs only after `jsonwebtoken` has accepted the signature, issuer, audience
   * and expiry. `payload` is `any` in `passport-jwt`'s types, so it is parsed
   * rather than cast — see `token-claims.ts`.
   */
  async validate(payload: unknown): Promise<AuthenticatedUser> {
    const claims = authTokenClaimsSchema.parse(payload);
    return this.users.resolve(claims);
  }
}
