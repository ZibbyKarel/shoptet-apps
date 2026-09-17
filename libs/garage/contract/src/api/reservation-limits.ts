/**
 * Admin management of the reservation limits: read and change the singleton.
 *
 * Ordinary users never call either of these. The cap they need in order to see
 * a correct grid rides along on the month summary
 * (`./reservations`' `monthReservationsOutputSchema`), exactly as the window
 * state they need rides along on the day overview.
 */

import * as z from 'zod';
import { reservationLimitSettingsSchema } from '../schemas/reservation-limits';
import { authed, contractErrors, noInputSchema } from './builder';

export const getReservationLimitSettingsContract = authed
  .input(noInputSchema)
  .output(reservationLimitSettingsSchema);

/**
 * Full replacement of the singleton, not a patch.
 *
 * The input is the settings schema itself, so an omitted field falls back to
 * its documented default rather than to the value currently stored — the same
 * deliberate choice as `updateReservationWindowSettingsContract`, and for the
 * same reason: the admin form always renders every field, and "PUT replaces the
 * resource" is easier to reason about than a patch whose result depends on
 * invisible state.
 */
export const updateReservationLimitSettingsInputSchema = reservationLimitSettingsSchema;
export type UpdateReservationLimitSettingsInput = z.infer<
  typeof updateReservationLimitSettingsInputSchema
>;
export type UpdateReservationLimitSettingsInputRaw = z.input<
  typeof updateReservationLimitSettingsInputSchema
>;

export const updateReservationLimitSettingsContract = authed
  .input(updateReservationLimitSettingsInputSchema)
  .output(reservationLimitSettingsSchema)
  .errors(contractErrors('VALIDATION_FAILED', 'CONFLICT'));
