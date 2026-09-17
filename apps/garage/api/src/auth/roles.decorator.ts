/**
 * Restricts a route to a set of roles.
 *
 * ```ts
 * ‍@Roles('ADMIN')
 * ‍@Get('users')
 * list() { … }
 * ```
 *
 * The role names come from the contract's `UserRole`, so a typo does not
 * compile and a role the domain does not have cannot be guarded on. An
 * undecorated route is open to every *authenticated* caller — `RolesGuard` only
 * has an opinion where this metadata is present.
 */

import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@garage/contract';

export const ROLES_KEY = 'garage:auth:roles';

export const Roles = (...roles: readonly UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
