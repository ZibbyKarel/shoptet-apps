/**
 * The admin's bulk-booking holder form's pure half: field shape, validation,
 * and the default.
 *
 * Deliberately its own file rather than importing `queue-target-input.ts`
 * from `../spot-dialog`: that module's default is computed against a
 * **filtered** list (`excludingReservedOrQueuedFor`, scoped to one spot on
 * one day), which bulk booking has no equivalent of — a batch spans up to a
 * month and never targets one cell. The shape happens to be identical (one
 * `userId` field, no guest branch — `WaitlistEntry.userId` is non-nullable
 * for bulk's queued days exactly as it is for a single queue join), but the
 * meaning of "the list" is different enough that sharing the function would
 * be sharing a coincidence, not a rule.
 */

import * as z from 'zod';
import type { HolderOption } from '../spot-dialog/holder-input';

/** The form's one field: the user this batch is for. */
export interface BulkHolderFormValues {
  readonly userId: string;
}

export const bulkHolderFormSchema: z.ZodType<BulkHolderFormValues, BulkHolderFormValues> = z.object(
  {
    userId: z.string().min(1),
  }
);

/**
 * The form's `userId` default: the viewer when they appear in `options`, and
 * the first option otherwise — never a value the `<select>` cannot actually
 * represent. `''` when `options` is empty, which is fine because the caller
 * gates the form's existence on `options.length > 0` before ever rendering
 * one, the same way `SpotDialog`'s `showHolderForm`/`showQueueTargetForm` do.
 */
export function defaultBulkHolderId(
  viewerUserId: string | null,
  options: readonly HolderOption[]
): string {
  if (viewerUserId !== null && options.some((option) => option.userId === viewerUserId)) {
    return viewerUserId;
  }
  return options[0]?.userId ?? '';
}
