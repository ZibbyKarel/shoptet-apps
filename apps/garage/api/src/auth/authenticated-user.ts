/**
 * The caller, as every guard, controller and service downstream sees it.
 *
 * This is what `JwtStrategy.validate()` returns, which is what Passport puts on
 * `request.user`, which is what `@CurrentUser()` hands to a handler. It is a
 * strict subset of the `User` row: no `icsToken` (the secret behind a personal
 * feed URL — nothing outside the ICS and settings handlers has any business
 * carrying it around), no `preferredParkingSpotId`, no timestamps.
 *
 * `role` is typed from the contract's `UserRole`, not re-declared, so the roles
 * this app can guard on cannot drift from the roles the contract defines.
 */

import type { UserRole } from '@garage/contract';

export interface AuthenticatedUser {
  /** `User.id` — the application's own uuid v7 primary key. */
  id: string;
  /** `User.oktaId` — the token's `sub`. The identity we provisioned against. */
  oktaId: string;
  email: string;
  name: string;
  role: UserRole;
  /**
   * Always `true` here. A deactivated user never becomes an `AuthenticatedUser`
   * — `AuthUserService` throws `FORBIDDEN` first. The field is kept so that
   * handlers reading it get the value rather than an absence they have to
   * interpret.
   */
  active: boolean;
}

/** The property Passport writes the authenticated user onto. */
export const REQUEST_USER_PROPERTY = 'user';

/**
 * Narrows the untyped `request.user` that Passport writes.
 *
 * `@types/passport` declares `Express.User` as an empty interface and
 * `request.user` as `Express.User | undefined`, so every read of it is
 * structurally `{}`. This is the one place that turns it back into a type,
 * and it checks rather than casts: a guard that ran out of order, or a route
 * that is `@Public()` but decorated `@Roles()`, produces `undefined` here
 * instead of a plausible-looking object with `undefined` fields.
 */
export function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['oktaId'] === 'string' &&
    typeof candidate['email'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['role'] === 'string' &&
    typeof candidate['active'] === 'boolean'
  );
}
