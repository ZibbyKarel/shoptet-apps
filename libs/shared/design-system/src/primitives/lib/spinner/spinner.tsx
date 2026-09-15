import { forwardRef, type HTMLAttributes } from 'react';

import { cx } from '../cx';

/**
 * The product's one loading animation — until now hand-rolled in app code at
 * `apps/lets-park/web/src/shell/screen-state/screen-state.tsx`'s
 * `ScreenLoading`, byte-for-byte: `size-6 animate-spin rounded-cta border-2
 * border-border border-t-brand-blue`. A spinning ring is exactly the kind of
 * decorative, state-carrying markup the design system should own rather than
 * leave as raw Tailwind behind an eslint-disable comment, so this primitive
 * exists to absorb that one call site (and any future one) unchanged.
 */
export type SpinnerSize = 'sm' | 'md';
export type SpinnerTone = 'brand';

/**
 * `md` (`size-6`) is `ScreenLoading`'s exact size and today's only real call
 * site. `sm` (`size-4`) is not invented for symmetry — it is the step
 * `Button`'s own inline loading spinner already uses
 * (`libs/shared/design-system/src/primitives/lib/button/button.tsx`), so a
 * caller reaching for a smaller ring lands on a size this codebase already
 * renders rather than a new one.
 */
const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'size-4',
  md: 'size-6',
};

/**
 * `Button`'s inline spinner draws its ring in `border-current
 * border-t-transparent` — it deliberately inherits the button's own text
 * colour rather than a fixed brand hue, which is a different mechanism, not
 * a second tone of this one. No call site anywhere needs a ring for a dark
 * (asphalt) surface today, so `tone` ships with the one real tone,
 * `brand`, rather than an `inverse` invented ahead of a call site.
 */
const TONE_CLASSES: Record<SpinnerTone, string> = {
  brand: 'border-border border-t-brand-blue',
};

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Track size. Defaults to `md`. */
  size?: SpinnerSize | undefined;
  /** Ring colour pair. Defaults to `brand`, today's only tone. */
  tone?: SpinnerTone | undefined;
}

/**
 * Indeterminate loading ring. Renders a `<span>`; the spin is a stock
 * `animate-spin` (1s linear, Tailwind's default) — the token set defines a
 * `--dur-base`/`--dur-fast` pair for *transitions* (see `CONTROL_TRANSITION`
 * in `control-size.ts`), but has no opinion on an animation's own speed, so
 * there is nothing here to override it with.
 *
 * **Accessibility**: every real call site pairs this with a visible text
 * label that already carries the announcement (`ScreenLoading`'s
 * `role="status"` `Stack` with a `Text` sibling), so, like `IconCircle`,
 * `aria-hidden` defaults to `true` — the component does not invent a role of
 * its own. A caller using `Spinner` **without** a visible label must supply
 * its own `role="status"` (or equivalent) and accessible name on an
 * ancestor, and may override `aria-hidden` through the ordinary props if the
 * spinner itself is meant to be the announced content.
 */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { size = 'md', tone = 'brand', className, 'aria-hidden': ariaHidden = true, ...rest },
  ref
) {
  return (
    <span
      {...rest}
      ref={ref}
      aria-hidden={ariaHidden}
      className={cx(
        'animate-spin rounded-cta border-2',
        SIZE_CLASSES[size],
        TONE_CLASSES[tone],
        className
      )}
    />
  );
});
