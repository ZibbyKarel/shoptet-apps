/**
 * The holder form's pure half: its field shape, its validation, and the
 * translation from flat field values to the contract's holder union.
 *
 * Flat, and then mapped — rather than validating the union directly — because
 * the union's members have different fields, and a react-hook-form resolver
 * needs every field to exist for the whole life of the form. `useAppForm`'s
 * `TIn`/`TOut` split could carry a Zod `.transform()` here instead; it is kept
 * out on purpose, so the mapping is a plain function with a plain test and the
 * form stays the same single-parameter `useAppForm<TValues>` shape as
 * `apps/garage/web/src/shell/admin/admin-spots-screen/spot-form-dialog.tsx`.
 *
 * **No `t()` anywhere below.** The schema is built once at module level, where
 * there is no translator; messages are resolved at render time from the issue's
 * path, the way `spot-form-dialog.tsx` resolves `spotsLabelRequired`.
 */

import * as z from 'zod';
import type { ReservationHolderInput } from '@garage/contract';

/**
 * The `Select` value that means "a guest, not a user". Not a uuid, so it can
 * never collide with one.
 */
export const GUEST_HOLDER_VALUE = 'GUEST';

/** One selectable user: what the picker shows, and the plate it hints. */
export interface HolderOption {
  readonly userId: string;
  readonly name: string;
  readonly licensePlate: string | null;
}

/** The form's field values. Flat, and all three always present. */
export interface HolderFormValues {
  /** A user id, or {@link GUEST_HOLDER_VALUE}. */
  readonly holderId: string;
  /** Only meaningful for a guest; empty otherwise. */
  readonly guestName: string;
  /** Blank means "use the holder's stored plate". */
  readonly licensePlate: string;
}

export const holderFormSchema: z.ZodType<HolderFormValues, HolderFormValues> = z
  .object({
    holderId: z.string().min(1),
    guestName: z.string(),
    licensePlate: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.holderId === GUEST_HOLDER_VALUE && values.guestName.trim() === '') {
      // A `message` is required, not decorative: `FormField` forwards
      // `fieldState.error?.message`, and a render that keys off
      // `fieldError === undefined` sees `undefined` for an issue with none.
      // The string is a **developer-facing marker** — the Czech copy is resolved
      // at render time from the catalogue, never from here.
      ctx.addIssue({ code: 'custom', path: ['guestName'], message: 'GUEST_NAME_REQUIRED' });
    }
  });

/** Blank, or whitespace only, is "not given" — never an empty string on the wire. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Flat field values as the contract's holder. */
export function toHolderInput(values: HolderFormValues): ReservationHolderInput {
  const licensePlate = orNull(values.licensePlate);

  if (values.holderId === GUEST_HOLDER_VALUE) {
    return { kind: 'GUEST', name: values.guestName.trim(), licensePlate };
  }
  return { kind: 'USER', userId: values.holderId, licensePlate };
}

/**
 * The stored plate to show as the plate field's placeholder: what this holder
 * gets if the admin types nothing. `null` for a guest, and for a user who has
 * none.
 */
export function plateHintFor(options: readonly HolderOption[], holderId: string): string | null {
  if (holderId === GUEST_HOLDER_VALUE) return null;
  return options.find((option) => option.userId === holderId)?.licensePlate ?? null;
}
