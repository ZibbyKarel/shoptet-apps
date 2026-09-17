/**
 * Reservation limits: the singleton settings entity holding how much one user
 * may book.
 *
 * Separate from `./reservation-window` on purpose. The window decides whether a
 * *month* is open to anybody; this decides how much *one person* may take while
 * it is. They are different rules with different audiences — an ordinary user
 * meets the window as a banner and the cap as a greyed-out day — and the
 * window model's own doc comment says it drives the window, which a per-user
 * quota does not. See `doc/decision/0312-*`.
 */

import * as z from 'zod';
import {
  DEFAULT_MONTHLY_RESERVATION_CAP,
  MAX_MONTHLY_RESERVATION_CAP,
  MIN_MONTHLY_RESERVATION_CAP,
} from '@garage/shared-types';

/**
 * Singleton settings row holding the reservation limits.
 *
 * The field carries its default, so `z.input` accepts a partial object while
 * `z.output` is fully populated — the same arrangement as
 * `reservationWindowSettingsSchema`, and what lets the update contract be a
 * replacement rather than a patch.
 *
 * One field today. It is an object rather than a bare integer because the
 * shape that survives a second limit being added is the one that does not
 * force every consumer to change when it is.
 */
export const reservationLimitSettingsSchema = z.object({
  /**
   * How many confirmed reservations one user may hold in a single calendar
   * month. Bounded exactly as the migration's `CHECK` bounds the column.
   */
  monthlyReservationCap: z
    .int()
    .min(MIN_MONTHLY_RESERVATION_CAP)
    .max(MAX_MONTHLY_RESERVATION_CAP)
    .default(DEFAULT_MONTHLY_RESERVATION_CAP),
});
export type ReservationLimitSettings = z.infer<typeof reservationLimitSettingsSchema>;
export type ReservationLimitSettingsInput = z.input<typeof reservationLimitSettingsSchema>;
