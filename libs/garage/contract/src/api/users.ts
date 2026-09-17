/**
 * Admin user management: list, and change role or activity.
 *
 * Users are never created through the API — they are provisioned from the Okta
 * token on first sign-in — and never deleted, because reservations and audit
 * entries reference them. Offboarding is `active: false`.
 */

import * as z from 'zod';
import { userSchema } from '../schemas/entities';
import { userRoleSchema } from '../schemas/enums';
import { dateOnlySchema, idSchema } from '../schemas/primitives';
import { authed, contractErrors } from './builder';

/**
 * What an admin may see of another person: every field of `userSchema` except
 * `icsToken`, listed rather than subtracted.
 *
 * ### Why a `pick`, when this used to be an `omit`
 *
 * It used to read `userSchema.omit({ icsToken: true })`, defended as "a field
 * added to the entity shows up here by default, which is the safe direction for
 * an admin view" — the argument `entities.ts` uses forty lines away to defend
 * `userSummarySchema` being a **pick**, for the opposite conclusion. Both
 * cannot be the safe direction, and the final review was right to say so.
 *
 * `pick` wins, and the tie-breaker is what each one costs when it is wrong:
 *
 * - Get `pick` wrong and a field an admin should see is missing from the admin
 *   screen. Visible on the first look at the page, fixed by adding a key here.
 * - Get `omit` wrong and the **next secret added to `User`** — the entity
 *   already carries one — is served to every admin, in a response nobody
 *   re-reads, with no error and nothing in review to catch it. `icsToken` is on
 *   this entity precisely because per-user secrets live here.
 *
 * "Admins see everything unless someone remembers to subtract it" is a default
 * that fails open. The one direction that has to be deliberate is *widening*,
 * so widening is what takes an edit here. That makes both projections of
 * `userSchema` — this one and `userSummarySchema` — allowlists, which is the
 * rule this file now states rather than a coincidence.
 *
 * The field set is **unchanged** by the switch: this is the same ten keys the
 * `omit` produced, so no response shape moves. Recorded in
 * `doc/decision/0247-*`.
 */
export const ADMIN_USER_FIELDS = {
  id: true,
  email: true,
  name: true,
  licensePlate: true,
  role: true,
  oktaId: true,
  active: true,
  preferredParkingSpotId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const adminUserSchema = userSchema.pick(ADMIN_USER_FIELDS);
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminListUsersInputSchema = z.object({
  role: userRoleSchema.optional(),
  active: z.boolean().optional(),
  /** Free-text match against name and email; the backend decides how. */
  search: z.string().min(1).max(200).optional(),
  /**
   * Scopes the list to users eligible to be added to this spot's queue on
   * this day: excludes anyone who already holds a reservation that day (any
   * spot — `Reservation(userId, date)` is unique, so a second one is
   * impossible) and anyone already in this spot's own queue that day
   * (`WaitlistEntry(parkingSpotId, userId, date)`). Only the admin queue-target
   * picker (`LotScreen`'s `queueTargetQuery`) sets this; every other caller
   * gets the unfiltered list, same as before.
   */
  excludingReservedOrQueuedFor: z
    .object({ parkingSpotId: idSchema, date: dateOnlySchema })
    .optional(),
});
export type AdminListUsersInput = z.infer<typeof adminListUsersInputSchema>;

export const adminListUsersOutputSchema = z.object({
  users: z.array(adminUserSchema),
});
export type AdminListUsersOutput = z.infer<typeof adminListUsersOutputSchema>;

export const adminListUsersContract = authed
  .input(adminListUsersInputSchema)
  .output(adminListUsersOutputSchema);

/**
 * Partial update: an omitted field is left alone. Only these two fields are an
 * admin's to change — a name, an email and a licence plate belong to the user.
 */
export const adminUpdateUserInputSchema = userSchema
  .pick({ role: true, active: true })
  .partial()
  .extend({ id: idSchema });
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserInputSchema>;

/**
 * `CONFLICT` guards the two ways an admin can lock the system: demoting or
 * deactivating the last remaining active admin, and deactivating themselves.
 */
export const adminUpdateUserContract = authed
  .input(adminUpdateUserInputSchema)
  .output(adminUserSchema)
  .errors(contractErrors('NOT_FOUND', 'CONFLICT', 'VALIDATION_FAILED'));
