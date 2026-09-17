/**
 * The reservation window: the singleton settings entity and the per-month
 * overview the UI renders from it
 * (`doc/decision/0004-mvp-scope-includes-design-features.md`).
 *
 * The state itself is never computed by a schema — it comes from
 * `monthLockState()` in `@garage/shared-types`, which the service layer
 * calls with the settings loaded from the database.
 */

import * as z from 'zod';
import {
  DEFAULT_OPEN_DAYS_BEFORE,
  DEFAULT_RESERVATION_LOCK_MODE,
  MAX_OPEN_DAYS_BEFORE,
  MIN_OPEN_DAYS_BEFORE,
} from '@garage/shared-types';
import { monthLockStateSchema, reservationLockModeSchema } from './enums';
import { dateOnlySchema, yearMonthSchema } from './primitives';

/**
 * Singleton settings row driving the window.
 *
 * Both fields carry their defaults, so `z.input` accepts a partial object while
 * `z.output` is fully populated. Consumers that need the pre-default shape use
 * `ReservationWindowSettingsInput`.
 */
export const reservationWindowSettingsSchema = z.object({
  /** How many days before the first of a month the month opens for booking. */
  openDaysBefore: z
    .int()
    .min(MIN_OPEN_DAYS_BEFORE)
    .max(MAX_OPEN_DAYS_BEFORE)
    .default(DEFAULT_OPEN_DAYS_BEFORE),
  /** Admin override of the automatic window. */
  lockMode: reservationLockModeSchema.default(DEFAULT_RESERVATION_LOCK_MODE),
});
export type ReservationWindowSettings = z.infer<typeof reservationWindowSettingsSchema>;
export type ReservationWindowSettingsInput = z.input<typeof reservationWindowSettingsSchema>;

/**
 * One month as shown in the admin overview and in the user-facing banner:
 * which month it is, when its window runs, and where it currently stands.
 *
 * `windowFrom` / `windowTo` are always the inclusive bounds the **AUTO** rule
 * would produce. They are reported even when `lockMode` overrides the state, so
 * the UI can explain what the automatic rule would have done — but that only
 * works if the UI can tell the two situations apart, which is why `lockMode`
 * travels with them.
 *
 * Read the payload in this order:
 *
 * 1. `state` is the truth: `NOT_YET_OPEN` / `OPEN` / `LOCKED`.
 * 2. `lockMode !== 'AUTO'` means `state` was **overridden by an admin**, and
 *    `windowFrom`/`windowTo` are therefore hypothetical. Rendering
 *    "otevře se 25. 12." from them in that case would be a false statement.
 */
export const monthWindowOverviewSchema = z.object({
  month: yearMonthSchema,
  windowFrom: dateOnlySchema,
  windowTo: dateOnlySchema,
  state: monthLockStateSchema,
  /** The setting `state` was derived under. `AUTO` ⇒ the window above applies. */
  lockMode: reservationLockModeSchema,
});
export type MonthWindowOverview = z.infer<typeof monthWindowOverviewSchema>;
