/**
 * Admin management of the reservation window: read and change the singleton
 * settings, and see where each month currently stands.
 *
 * Ordinary users never call any of these — the window state they need for a
 * given day rides along on the day overview (`./overview`).
 */

import * as z from 'zod';
import { MAX_MONTH_WINDOW_SPAN } from '@garage/shared-types';
import { yearMonthSchema } from '../schemas/primitives';
import {
  monthWindowOverviewSchema,
  reservationWindowSettingsSchema,
} from '../schemas/reservation-window';
import { authed, contractErrors, noInputSchema } from './builder';

export const getReservationWindowSettingsContract = authed
  .input(noInputSchema)
  .output(reservationWindowSettingsSchema);

/**
 * Full replacement of the singleton, not a patch.
 *
 * The input is the settings schema itself, so an omitted field falls back to its
 * documented default (`openDaysBefore: 7`, `lockMode: 'AUTO'`) rather than to the
 * value currently stored. That is deliberate — there are exactly two fields, the
 * admin form always renders both, and "PUT replaces the resource" is easier to
 * reason about than a patch whose result depends on invisible state. Send both.
 */
export const updateReservationWindowSettingsInputSchema = reservationWindowSettingsSchema;
export type UpdateReservationWindowSettingsInput = z.infer<
  typeof updateReservationWindowSettingsInputSchema
>;
export type UpdateReservationWindowSettingsInputRaw = z.input<
  typeof updateReservationWindowSettingsInputSchema
>;

export const updateReservationWindowSettingsContract = authed
  .input(updateReservationWindowSettingsInputSchema)
  .output(reservationWindowSettingsSchema)
  .errors(contractErrors('VALIDATION_FAILED', 'CONFLICT'));

/**
 * Number of months in the inclusive range `from`–`to`, both `YYYY-MM`.
 *
 * Kept local and deliberately tiny: this is the only place in the contract that
 * needs month arithmetic, and `libs/garage/shared-types` owns day-level Europe/Prague
 * logic, not string-range counting. Assumes `from <= to`, which the refinement
 * order below guarantees.
 */
function monthSpan(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split('-').map(Number) as [number, number];
  const [toYear, toMonth] = to.split('-').map(Number) as [number, number];
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
}

/**
 * Inclusive range of months to report on. Ordering is checked structurally —
 * `YYYY-MM` sorts lexicographically, so no date arithmetic is needed and the
 * check stays inside the schema.
 *
 * The maximum span is structural too (`MAX_MONTH_WINDOW_SPAN`), for the same
 * reason `bulk` caps `dates` with `MAX_BULK_BOOKING_DAYS`: a limit the client
 * can only learn by being rejected is not part of the contract. That is why
 * this procedure declares no `VALIDATION_FAILED` — there is no domain rule left
 * for it that a structurally valid input could break.
 */
export const listMonthWindowsInputSchema = z
  .object({
    from: yearMonthSchema,
    to: yearMonthSchema,
  })
  .refine((value) => value.from <= value.to, {
    error: 'from must not be after to',
    path: ['to'],
  })
  .refine(
    (value) => value.from > value.to || monthSpan(value.from, value.to) <= MAX_MONTH_WINDOW_SPAN,
    {
      error: `The range must not span more than ${MAX_MONTH_WINDOW_SPAN} months`,
      path: ['to'],
    }
  );
export type ListMonthWindowsInput = z.infer<typeof listMonthWindowsInputSchema>;

export const listMonthWindowsOutputSchema = z.object({
  /** One entry per month in the requested range, ascending. */
  months: z.array(monthWindowOverviewSchema),
  /**
   * The settings the states were derived under, echoed so the admin tab can
   * render the table and the form from a single response.
   */
  settings: reservationWindowSettingsSchema,
});
export type ListMonthWindowsOutput = z.infer<typeof listMonthWindowsOutputSchema>;

export const listMonthWindowsContract = authed
  .input(listMonthWindowsInputSchema)
  .output(listMonthWindowsOutputSchema);
