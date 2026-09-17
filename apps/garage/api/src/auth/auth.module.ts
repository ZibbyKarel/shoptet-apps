/**
 * Wiring for the authentication layer.
 *
 * The **guards are not registered here.** `JwtAuthGuard` and `RolesGuard` are
 * `APP_GUARD` providers in `AppModule`, because a global guard must be
 * registered exactly once, in a known order relative to `ThrottlerGuard`, and
 * scattering that across feature modules is how the order stops being
 * knowable. This module owns the strategy and the two services.
 *
 * `JwksVerifierService` is exported: Task 15's Socket.io gateway authenticates
 * its handshake with `verifyToken()`, and must reuse this process's single
 * JWKS client rather than open a second one. `AuthUserService` is exported for
 * the same reason — the gateway has to resolve a handshake's claims to a user
 * through the same JIT provisioning path an HTTP request takes.
 *
 * `PassportModule.register({ session: false })` is explicit: this API is
 * stateless and must never try to serialise a user into a session store it
 * does not have.
 */

import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthUserService } from './auth-user.service';
import { JwksVerifierService } from './jwks-verifier.service';
import { JWT_STRATEGY_NAME, JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule.register({
      defaultStrategy: JWT_STRATEGY_NAME,
      session: false,
    }),
  ],
  providers: [JwksVerifierService, AuthUserService, JwtStrategy],
  exports: [JwksVerifierService, AuthUserService],
})
export class AuthModule {}
