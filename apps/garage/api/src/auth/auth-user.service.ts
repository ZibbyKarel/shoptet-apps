/**
 * Just-in-time provisioning: turning a verified token into a `User` row.
 *
 * There is no sign-up screen. The first time somebody the company's Okta
 * recognises presents a valid token, the row is created here, and every later
 * request finds it. Everything below runs **after** the signature, issuer,
 * audience and expiry have been checked — this service never sees an unverified
 * claim.
 *
 * ## Identity resolution, in order
 *
 * 1. **`oktaId` (the token's `sub`).** The provisioning key. It is what Okta
 *    guarantees stable for a person; an email is a mutable label.
 * 2. **`email`, as a fallback.** Covers the two cases `sub` alone cannot: a row
 *    seeded ahead of a person's first login, and an Okta account that was
 *    deleted and recreated (new `sub`, same company address). The match adopts
 *    the token's `sub` onto the row.
 * 3. **Create.** With a fresh `icsToken`.
 *
 * Step 2 is a deliberate, security-relevant choice — an email match rebinds a
 * row to a new `sub` — and is written up with its risk in
 * `doc/decision/0044-*`. In short: this deployment has exactly one identity
 * provider, the company's Okta, which owns the address space; a token it signed
 * saying "`sub` X is alice@…" *is* Alice.
 *
 * ## Concurrency
 *
 * A person's browser opens several requests at once, so "first request ever"
 * is routinely several first requests at once. Read-then-create would let two
 * of them both find nothing and both insert. The database is what settles it:
 * `oktaId`, `email` and `icsToken` are all unique, so the loser gets P2002 —
 * which is caught here and retried, at which point the read finds the row the
 * winner wrote. That is why {@link MAX_PROVISIONING_ATTEMPTS} exists rather
 * than an application-level lock.
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { User } from '@garage/database';
import { DomainError } from '../common/errors/domain-error';
import { isUniqueConstraintViolation } from '../common/errors/prisma-error-mapping';
import { PrismaService } from '../database/prisma.service';
import type { AuthenticatedUser } from './authenticated-user';
import type { AuthTokenClaims } from './token-claims';

/**
 * Bytes of entropy in an `icsToken`. 32 bytes is the same order as a session
 * secret: the token *is* the only credential on the personal calendar feed URL,
 * which is fetched by calendar clients that cannot send an Authorization
 * header.
 */
export const ICS_TOKEN_BYTES = 32;

/**
 * How many times a provisioning race is retried before giving up.
 *
 * Three covers the realistic case (a burst of parallel first requests, where a
 * single retry already finds the winner's row) and the pathological one (an
 * `icsToken` collision — at 2^256 possibilities, never). A bounded loop rather
 * than `while (true)`: a P2002 this code cannot resolve must surface as an
 * error, not as a hang.
 */
export const MAX_PROVISIONING_ATTEMPTS = 3;

/**
 * A URL-safe random secret for the personal ICS feed.
 *
 * `randomBytes` (CSPRNG), never `Math.random`. `base64url` because the value is
 * pasted into a URL path.
 */
export function generateIcsToken(): string {
  return randomBytes(ICS_TOKEN_BYTES).toString('base64url');
}

@Injectable()
export class AuthUserService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AuthUserService.name) private readonly logger: PinoLogger
  ) {}

  /**
   * The single entry point: verified claims in, an authenticated caller out.
   *
   * Throws `DomainError('FORBIDDEN')` for a deactivated user — offboarding sets
   * `active: false` rather than deleting the row, and that must read as "you
   * may not do this" (403, a contract code the frontend has copy for), not as
   * "log in again" (401, which would send the person round the Okta loop
   * forever).
   */
  async resolve(claims: AuthTokenClaims): Promise<AuthenticatedUser> {
    const user = await this.findOrProvision(claims);

    if (!user.active) {
      this.logger.warn({ userId: user.id }, 'Deactivated user presented a valid token');
      throw new DomainError('FORBIDDEN', { message: 'The user account is deactivated.' });
    }

    return {
      id: user.id,
      oktaId: user.oktaId,
      email: user.email,
      name: user.name,
      role: user.role,
      active: user.active,
    };
  }

  private async findOrProvision(claims: AuthTokenClaims): Promise<User> {
    let lastConflict: unknown;

    for (let attempt = 1; attempt <= MAX_PROVISIONING_ATTEMPTS; attempt += 1) {
      const existing = await this.prisma.client.user.findUnique({
        where: { oktaId: claims.sub },
      });
      if (existing !== null) {
        return this.refreshName(existing, claims);
      }

      // Provisioning needs an address, and inventing one would create a row
      // that can never be matched again and can never receive a notification.
      // A valid token without `email` means the IdP client is missing the
      // `email` scope — an operator misconfiguration, logged as such.
      if (claims.email === undefined) {
        this.logger.error(
          { oktaId: claims.sub },
          'Token carries no email claim and the subject is not provisioned; check the IdP scopes'
        );
        throw new UnauthorizedException('The token does not identify a provisionable user.');
      }

      try {
        return await this.linkOrCreate(claims, claims.email);
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }
        // Lost a race (or, vanishingly, collided on a random `icsToken`). Loop:
        // the next read finds whatever the winner wrote.
        lastConflict = error;
        this.logger.debug(
          { oktaId: claims.sub, attempt },
          'Provisioning lost a unique-constraint race; retrying'
        );
      }
    }

    this.logger.error(
      { err: lastConflict, oktaId: claims.sub },
      'Provisioning kept losing unique-constraint races'
    );
    throw lastConflict instanceof Error
      ? lastConflict
      : new Error('Provisioning failed after repeated unique-constraint conflicts.');
  }

  /**
   * The email fallback, and the create.
   *
   * Split out so the retry loop above stays readable; both branches can raise
   * P2002 and both are covered by it.
   */
  private async linkOrCreate(claims: AuthTokenClaims, email: string): Promise<User> {
    const byEmail = await this.prisma.client.user.findUnique({ where: { email } });

    if (byEmail !== null) {
      this.logger.warn(
        { userId: byEmail.id, previousOktaId: byEmail.oktaId, oktaId: claims.sub },
        'Matched an existing user by email and rebound it to the token subject'
      );
      return this.prisma.client.user.update({
        where: { id: byEmail.id },
        data: {
          oktaId: claims.sub,
          ...(claims.name === undefined || claims.name === byEmail.name
            ? {}
            : { name: claims.name }),
        },
      });
    }

    const created = await this.prisma.client.user.create({
      data: {
        oktaId: claims.sub,
        email,
        // No `name` claim means the IdP was not asked for the `profile` scope.
        // The address is a worse label than a real name and a much better one
        // than an empty string, which `userSchema` forbids anyway.
        name: claims.name ?? email,
        icsToken: generateIcsToken(),
      },
    });
    this.logger.info({ userId: created.id }, 'Provisioned a new user from a verified token');
    return created;
  }

  /**
   * Propagates a display-name change from the IdP.
   *
   * Only `name`. `email` is **not** refreshed from the token: it is the fallback
   * identity key above, so rewriting it from a claim would let an address change
   * at the IdP silently take over another row (and it is the one column here
   * whose update can itself raise P2002). Address changes are an admin
   * operation.
   *
   * The comparison keeps the hot path read-only — the update runs on the rare
   * request where the name actually changed, not on every request.
   */
  private async refreshName(user: User, claims: AuthTokenClaims): Promise<User> {
    if (claims.name === undefined || claims.name === user.name) {
      return user;
    }
    this.logger.info({ userId: user.id }, 'Updated the display name from the token claims');
    return this.prisma.client.user.update({
      where: { id: user.id },
      data: { name: claims.name },
    });
  }
}
