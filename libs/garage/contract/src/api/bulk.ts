/**
 * Bulk booking — the two-step flow from
 * `doc/decision/0004-mvp-scope-includes-design-features.md` §Bulk reservation.
 *
 * 1. `previewBulk` proposes a schedule for the selected days. It writes nothing.
 * 2. `confirmBulk` takes **the same day list** and performs the writes, then
 *    reports what actually happened.
 *
 * Both procedures also take an optional `holderId`, naming whom the batch is
 * for when the caller is not booking for themselves.
 *
 * The two outputs are deliberately the same shape, keyed by `date`, differing
 * only in that the confirmed one carries the ids of the rows it created. That
 * is what makes the difference legible: the client keeps the preview it showed
 * the user, zips it with the result by `date` and can say "we proposed E2.92,
 * you ended up third in the queue" — see
 * `doc/decision/0019-draft-and-confirm-bulk-reservation.md` for why the
 * server cannot compute that diff itself.
 */

import * as z from 'zod';
import {
  BULK_DAY_OUTCOMES,
  BULK_UNAVAILABLE_REASONS,
  MAX_BULK_BOOKING_DAYS,
} from '@garage/shared-types';
import { dateOnlySchema, idSchema, yearMonthSchema } from '../schemas/primitives';
import { authed, contractErrors } from './builder';

export const bulkDayOutcomeKindSchema = z.enum(BULK_DAY_OUTCOMES);
export type BulkDayOutcomeKind = z.infer<typeof bulkDayOutcomeKindSchema>;

export const bulkUnavailableReasonSchema = z.enum(BULK_UNAVAILABLE_REASONS);
export type BulkUnavailableReason = z.infer<typeof bulkUnavailableReasonSchema>;

/**
 * The day list both procedures take, plus who it is for.
 *
 * The refinements are **structural** — they are about the list itself, not about
 * the world. Whether a day is in the past, inside the open window or a business
 * day depends on database state and on `Europe/Prague` "today", so it stays in
 * the service layer (ruling window-2, and the same reasoning that keeps
 * `dateOnlySchema` format-only).
 */
const bulkBookingShapeSchema = z.object({
  dates: z.array(dateOnlySchema).min(1).max(MAX_BULK_BOOKING_DAYS),
  /**
   * Who the batch is for, when the caller is not booking for themselves.
   *
   * A bare user id, not `reservationHolderInputSchema`'s guest-capable union:
   * a bulk day that misses its spot falls onto `WaitlistEntry`, whose `userId`
   * is non-nullable, so there is nobody to queue but an active user — the same
   * reason `joinWaitlistInputSchema.holderId` is a bare id (`waitlist.ts`).
   *
   * **Only an admin may name a holder other than themselves.** That is not
   * expressible in a schema — a schema cannot see who is calling — so it is
   * `ReservationPolicy.assertMayNameWaitlistTarget`, and the refusal is the
   * `FORBIDDEN` the base builder already declares.
   */
  holderId: idSchema.optional(),
});

export const bulkBookingInputSchema = bulkBookingShapeSchema
  .refine((value) => new Set(value.dates).size === value.dates.length, {
    error: 'dates must not contain duplicates',
    path: ['dates'],
  })
  .refine((value) => new Set(value.dates.map((date) => date.slice(0, 7))).size === 1, {
    error: 'dates must all fall in the same calendar month',
    path: ['dates'],
  });
export type BulkBookingInput = z.infer<typeof bulkBookingInputSchema>;

/** A day the allocator can give a free spot. */
export const bulkDayAssignedPlanSchema = z.object({
  outcome: z.literal('SPOT_ASSIGNED'),
  date: dateOnlySchema,
  parkingSpotId: idSchema,
  /** Denormalized so the modal can render the plan without a second request. */
  parkingSpotLabel: z.string().min(1),
  /** `true` when this is the user's `preferredParkingSpotId`. */
  isPreferredSpot: z.boolean(),
});

/** A day where every spot was taken and the user goes into a queue. */
export const bulkDayQueuedPlanSchema = z.object({
  outcome: z.literal('QUEUED'),
  date: dateOnlySchema,
  parkingSpotId: idSchema,
  parkingSpotLabel: z.string().min(1),
  /** 1-based position the user would take / took in that spot's queue. */
  waitlistPosition: z.int().positive(),
});

/**
 * A day nothing could be done for. Reported inside a *successful* response:
 * one impossible day must not discard the rest of the batch.
 */
export const bulkDayUnavailableSchema = z.object({
  outcome: z.literal('UNAVAILABLE'),
  date: dateOnlySchema,
  reason: bulkUnavailableReasonSchema,
});

/** One day of the read-only proposal. */
export const bulkDayPlanSchema = z.discriminatedUnion('outcome', [
  bulkDayAssignedPlanSchema,
  bulkDayQueuedPlanSchema,
  bulkDayUnavailableSchema,
]);
export type BulkDayPlan = z.infer<typeof bulkDayPlanSchema>;

/**
 * One day of the real result. Each member is a superset of the matching plan
 * member plus the id of the row that was written, so `BulkDayResult` is
 * assignable to `BulkDayPlan` field by field and the two zip cleanly by `date`.
 */
export const bulkDayResultSchema = z.discriminatedUnion('outcome', [
  bulkDayAssignedPlanSchema.extend({ reservationId: idSchema }),
  bulkDayQueuedPlanSchema.extend({ waitlistEntryId: idSchema }),
  bulkDayUnavailableSchema,
]);
export type BulkDayResult = z.infer<typeof bulkDayResultSchema>;

/** Counts for the modal's headline; derivable from `days`, sent for convenience. */
export const bulkBookingSummarySchema = z.object({
  assigned: z.int().nonnegative(),
  queued: z.int().nonnegative(),
  unavailable: z.int().nonnegative(),
  /** How many assigned days landed on the user's preferred spot. */
  preferredSpotHits: z.int().nonnegative(),
});
export type BulkBookingSummary = z.infer<typeof bulkBookingSummarySchema>;

export const previewBulkOutputSchema = z.object({
  /** The single month the request covers; enforced by the input refinement. */
  month: yearMonthSchema,
  /**
   * The spot the plan was optimised around, echoed so the UI can explain
   * "we started from your preferred spot" — or that there is none set.
   */
  preferredParkingSpotId: idSchema.nullable(),
  /** One entry per requested day, in the order the days were requested. */
  days: z.array(bulkDayPlanSchema),
  summary: bulkBookingSummarySchema,
});
export type PreviewBulkOutput = z.infer<typeof previewBulkOutputSchema>;

export const confirmBulkOutputSchema = z.object({
  month: yearMonthSchema,
  preferredParkingSpotId: idSchema.nullable(),
  days: z.array(bulkDayResultSchema),
  summary: bulkBookingSummarySchema,
});
export type ConfirmBulkOutput = z.infer<typeof confirmBulkOutputSchema>;

/**
 * Propose a schedule. **Writes nothing** — no reservation, no queue entry, no
 * audit record.
 *
 * It still declares the window errors, because previewing a booking for a month
 * you may not book is the same rule as booking it: the answer would be a plan
 * the user can never confirm. `PAST_DATE` rejects the whole request rather than
 * marking single days, because a request containing a past day is a frontend
 * bug, not a user choice worth reporting per day.
 */
export const previewBulkContract = authed
  .input(bulkBookingInputSchema)
  .output(previewBulkOutputSchema)
  .errors(
    contractErrors(
      'PAST_DATE',
      'OUT_OF_HORIZON',
      'RESERVATIONS_LOCKED',
      'VALIDATION_FAILED',
      'NOT_FOUND'
    )
  );

/**
 * Perform the booking. One transaction; days somebody took in the meantime fall
 * into the queue and are reported, not discarded.
 *
 * Same input as `previewBulk` by design — the server does not trust, and does
 * not receive, the plan the client is holding.
 */
export const confirmBulkContract = authed
  .input(bulkBookingInputSchema)
  .output(confirmBulkOutputSchema)
  .errors(
    contractErrors(
      'PAST_DATE',
      'OUT_OF_HORIZON',
      'RESERVATIONS_LOCKED',
      'MONTHLY_RESERVATION_LIMIT_REACHED',
      'VALIDATION_FAILED',
      'CONFLICT',
      'NOT_FOUND'
    )
  );
