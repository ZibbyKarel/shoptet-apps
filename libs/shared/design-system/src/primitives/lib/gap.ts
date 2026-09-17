import type { SpacingKey } from '@garage/design-system/tokens';

/**
 * Every `gap-{step}` Tailwind class, spelled out as a literal — same
 * rationale as `PADDING_CLASSES` in `padding.ts`: Tailwind v4 finds classes
 * by scanning source text statically, so a template like `` `gap-${step}` ``
 * never appears verbatim in any file and Tailwind emits nothing for it.
 *
 * Unlike `Padding`, `gap` has no documented `0` use case in the spec's
 * evidence table (`flex flex-col gap-*` / `flex items-center gap-*`, always
 * with a real step) — so this map is keyed on `SpacingKey` alone, not
 * `SpacingKey | 0`. A caller that wants no gap simply omits the prop.
 *
 * Exported (only) so `gap.spec.ts` can walk every entry and assert it against
 * `` `gap-${step}` `` — a hand-typed table this size is the likeliest place
 * for a wrong *value* behind a correct key, which nothing else here would
 * catch.
 */
export const GAP_CLASSES: Record<SpacingKey, string> = {
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
  10: 'gap-10',
  12: 'gap-12',
  16: 'gap-16',
  20: 'gap-20',
  24: 'gap-24',
  32: 'gap-32',
};

/** Resolves a spacing step to its `gap-*` Tailwind class. */
export function resolveGap(step: SpacingKey): string {
  return GAP_CLASSES[step];
}

/**
 * Per-axis `gap-x-{step}` literals, same rationale as `GAP_CLASSES` above.
 * Added for `Stack`'s `spacingX`/`spacingY`, which override `spacing` on one
 * axis only — e.g. `bulk-modal.tsx`'s footnote row, which wraps at
 * `gap-x-4 gap-y-1` rather than one uniform step.
 */
export const GAP_X_CLASSES: Record<SpacingKey, string> = {
  1: 'gap-x-1',
  2: 'gap-x-2',
  3: 'gap-x-3',
  4: 'gap-x-4',
  5: 'gap-x-5',
  6: 'gap-x-6',
  8: 'gap-x-8',
  10: 'gap-x-10',
  12: 'gap-x-12',
  16: 'gap-x-16',
  20: 'gap-x-20',
  24: 'gap-x-24',
  32: 'gap-x-32',
};

/** Per-axis `gap-y-{step}` literals — see `GAP_X_CLASSES`. */
export const GAP_Y_CLASSES: Record<SpacingKey, string> = {
  1: 'gap-y-1',
  2: 'gap-y-2',
  3: 'gap-y-3',
  4: 'gap-y-4',
  5: 'gap-y-5',
  6: 'gap-y-6',
  8: 'gap-y-8',
  10: 'gap-y-10',
  12: 'gap-y-12',
  16: 'gap-y-16',
  20: 'gap-y-20',
  24: 'gap-y-24',
  32: 'gap-y-32',
};

/** Resolves a spacing step to its `gap-x-*` Tailwind class. */
export function resolveGapX(step: SpacingKey): string {
  return GAP_X_CLASSES[step];
}

/** Resolves a spacing step to its `gap-y-*` Tailwind class. */
export function resolveGapY(step: SpacingKey): string {
  return GAP_Y_CLASSES[step];
}
