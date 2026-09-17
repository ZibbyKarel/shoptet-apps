/**
 * What every oRPC handler is given besides its validated input.
 *
 * Deliberately just the caller. Authentication and authorization have already
 * happened by the time a handler runs — `JwtAuthGuard` put the user on the
 * request and `RolesGuard` checked `@Roles()` — so the context carries the
 * result of that, never the means to redo it. Nothing here reads a header, and
 * no handler may re-decide who the caller is.
 */

import type { AuthenticatedUser } from '../auth/authenticated-user';

export interface OrpcContext {
  /** The authenticated caller, as `JwtAuthGuard` resolved them. */
  readonly user: AuthenticatedUser;
}
