/**
 * The caller's own profile and settings: licence plate, preferred parking spot,
 * and the ICS feed token.
 */

import * as z from 'zod';
import { userSchema } from '../schemas/entities';
import { idSchema } from '../schemas/primitives';
import { authed, contractErrors, noInputSchema } from './builder';

/**
 * The caller's own record, `icsToken` included.
 *
 * That is safe precisely because it is the caller's own — the settings screen
 * has to render the feed URL, and it builds it with `buildIcsFeedUrl` from
 * `./ics`. Other people's users are exposed through `userSummarySchema`
 * (three fields) or `adminUserSchema` (everything but the token).
 */
export const myProfileSchema = userSchema;
export type MyProfile = z.infer<typeof myProfileSchema>;

export const getMyProfileContract = authed.input(noInputSchema).output(myProfileSchema);

/**
 * Partial update with two-valued optional fields. The convention, which the
 * backend must implement exactly:
 *
 * - **absent** — leave the current value alone;
 * - **`null`** — clear it (no licence plate / no preferred spot);
 * - a value — set it.
 *
 * Both fields are nullable on the entity, so "clear" has to be expressible; a
 * plain `.partial()` could not tell it apart from "unchanged".
 */
export const updateMySettingsInputSchema = z.object({
  /** Czech licence plate ("SPZ"). */
  licensePlate: z.string().min(1).max(16).nullable().optional(),
  /**
   * First choice for bulk booking. Never applied to a single-day reservation
   * (`doc/decision/0004-*` §Preferred parking spot).
   */
  preferredParkingSpotId: idSchema.nullable().optional(),
});
export type UpdateMySettingsInput = z.infer<typeof updateMySettingsInputSchema>;

/**
 * `NOT_FOUND` is the preferred spot that does not exist; `VALIDATION_FAILED`
 * covers pointing it at a deactivated one.
 */
export const updateMySettingsContract = authed
  .input(updateMySettingsInputSchema)
  .output(myProfileSchema)
  .errors(contractErrors('NOT_FOUND', 'VALIDATION_FAILED'));

export const regenerateIcsTokenOutputSchema = z.object({
  /**
   * The new token. The old feed URL stops working the moment this returns, so
   * the UI has to tell the user their calendar subscription needs replacing.
   *
   * Only the token is returned: the URL is built client-side with
   * `buildIcsFeedUrl(origin, icsToken)`, because the contract has no idea which
   * origin the deployment is reachable on and should not guess.
   */
  icsToken: z.string().min(1),
});
export type RegenerateIcsTokenOutput = z.infer<typeof regenerateIcsTokenOutputSchema>;

/**
 * Invalidate the current ICS feed URL and issue a new one. Takes no input.
 *
 * **Declares nothing beyond the inherited `FORBIDDEN`.** The only failure a
 * caller could ever see here is a unique-constraint collision on a freshly
 * generated random token — and that is not a failure mode the client can act
 * on, it is a retry. Task 12 must therefore generate-and-retry inside the
 * handler rather than surfacing a `CONFLICT` the UI would have no words for.
 * Declaring a code no handler throws is the same mistake as throwing an
 * undeclared one (`doc/decision/0018-*`, `doc/decision/0021-*`).
 */
export const regenerateIcsTokenContract = authed
  .input(noInputSchema)
  .output(regenerateIcsTokenOutputSchema);
