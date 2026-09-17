/**
 * The admin's queue-target form's pure half: field shape and validation.
 *
 * Narrower than `holder-input.ts` on purpose: `WaitlistEntry.userId` is
 * non-nullable, so there is no guest branch and nothing to map — the form's
 * `userId` **is** `joinWaitlistInputSchema`'s `holderId`, so unlike
 * `toHolderInput` there is no translation function here.
 */

import * as z from 'zod';
import type { HolderOption } from './holder-input';

/** The form's one field: the user to queue. */
export interface QueueTargetFormValues {
  readonly userId: string;
}

export const queueTargetFormSchema: z.ZodType<QueueTargetFormValues, QueueTargetFormValues> =
  z.object({
    userId: z.string().min(1),
  });

/**
 * The queue form's `userId` default: `viewerUserId` when it appears in
 * `options`, and the first option otherwise — never a value the `<select>`
 * cannot actually represent.
 *
 * `options` is a **filtered** list (`excludingReservedOrQueuedFor`): an admin
 * who already holds a reservation that day, or is already queued for this
 * spot, is not in it, even though `viewerUserId` still names them. Defaulting
 * to `viewerUserId` regardless would leave the `<select>` showing no option
 * selected while the form's state still held the excluded id — so
 * `queueTargetFormSchema`'s `userId: z.string().min(1)` would still pass, and
 * submitting would call `onJoinWaitlist` with an id the list-fetch has
 * already ruled out, trading a pre-flight refusal for the very
 * `RESERVATION_LIMIT_REACHED` this filtered list exists to avoid.
 *
 * `''` when `options` is empty: `showQueueTargetForm` already gates the
 * form's existence on `options.length > 0`, so that value never reaches a
 * rendered `<select>`.
 */
export function defaultQueueTargetId(
  viewerUserId: string | null,
  options: readonly HolderOption[]
): string {
  if (viewerUserId !== null && options.some((option) => option.userId === viewerUserId)) {
    return viewerUserId;
  }
  return options[0]?.userId ?? '';
}
