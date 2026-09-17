/**
 * Zod mirrors of the domain enumerations.
 *
 * The allowed values live exactly once, in `@garage/shared-types`, because
 * `apps/garage/api` and `libs/shared/i18n` need them without pulling in Zod. The schemas here
 * wrap those tuples, and the exported types stay derived through `z.infer`.
 */

import * as z from 'zod';
import {
  MONTH_LOCK_STATES,
  PARKING_GROUPS,
  RESERVATION_LOCK_MODES,
  USER_ROLES,
} from '@garage/shared-types';

export const parkingGroupSchema = z.enum(PARKING_GROUPS);
export type ParkingGroup = z.infer<typeof parkingGroupSchema>;

export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

export const reservationLockModeSchema = z.enum(RESERVATION_LOCK_MODES);
export type ReservationLockMode = z.infer<typeof reservationLockModeSchema>;

export const monthLockStateSchema = z.enum(MONTH_LOCK_STATES);
export type MonthLockState = z.infer<typeof monthLockStateSchema>;
