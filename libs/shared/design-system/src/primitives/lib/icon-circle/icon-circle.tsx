import { forwardRef, type HTMLAttributes } from 'react';

import { cx } from '../cx';

/**
 * Small round-or-square badge holding one glyph or character — the leading
 * mark of a status banner (`lot-header.tsx`, `login-screen.tsx`) and the
 * state marks inside a parking tile (`spot-tile.tsx`, `spot-dialog.tsx`).
 * All six real call sites are `inline-flex … items-center justify-center` at
 * one of three fixed sizes; they differ in shape, background tone, and the
 * glyph's own type size/weight, all exposed as props here.
 */
export type IconCircleSize = 'xs' | 'sm' | 'md' | 'lg';
export type IconCircleShape = 'square' | 'circle';
export type IconCircleTone = 'yellow' | 'green' | 'blue' | 'translucent' | 'translucent-light';
export type IconCircleFontSize = 'xs' | 'sm' | 'base' | 'md' | 'xl' | '2xl';
export type IconCircleWeight = 'normal' | 'bold';

/**
 * `lg` (`size-12`, 48px) added for the product logo tile (`brand.tsx`'s `lg`
 * lockup, drawn at 48px in the design) — the scale used to top out at `md`
 * (32px), a real, visible regression from the design that `brand.tsx`
 * documents and works around by falling back to `md`.
 */
const SIZE_CLASSES: Record<IconCircleSize, string> = {
  xs: 'size-5',
  sm: 'size-6',
  md: 'size-8',
  lg: 'size-12',
};

/** `rounded-xs` for the status-banner glyphs, `rounded-cta` for the tile marks. */
const SHAPE_CLASSES: Record<IconCircleShape, string> = {
  square: 'rounded-xs',
  circle: 'rounded-cta',
};

/**
 * Two real tones (`translucent`, `translucent-light`) carry no foreground
 * colour of their own — `spot-tile.tsx`'s `bg-neutral-0/15` marks and
 * `login-screen.tsx`'s `bg-bg/20` mark both inherit whatever text colour
 * their surrounding context sets. The other three are solid brand fills.
 * `yellow` and `blue` pair with the matching `text-fg-on-*` token, same
 * pairing `Badge` and `Avatar` use. `green` deliberately does **not** —
 * `--fg-on-green` (white) on `--brand-green` measures 1.88:1, the same
 * failure `toast.tsx`'s `GLYPH_CLASSES.success` documents and fixes by
 * drawing the glyph in `--brand-dark` instead (8.47:1); this tone follows
 * that exact precedent rather than reintroducing the pairing.
 */
const TONE_CLASSES: Record<IconCircleTone, string> = {
  yellow: 'bg-brand-yellow text-fg-on-yellow',
  green: 'bg-brand-green text-brand-dark',
  blue: 'bg-brand-blue text-fg-on-blue',
  translucent: 'bg-neutral-0/15',
  'translucent-light': 'bg-bg/20',
};

/**
 * `md` and `2xl` fill the two gaps `brand.tsx` reported: the logo tile's "P"
 * glyph is drawn at `text-md` for the `sm` step and `text-2xl` for the `lg`
 * step (which also needed `IconCircleSize`'s new `lg` entry above), and
 * without them the glyph rounded down to `base`/`xl`.
 */
const FONT_SIZE_CLASSES: Record<IconCircleFontSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  md: 'text-md',
  xl: 'text-xl',
  '2xl': 'text-2xl',
};

const WEIGHT_CLASSES: Record<IconCircleWeight, string> = {
  normal: 'font-normal',
  bold: 'font-bold',
};

export interface IconCircleProps extends HTMLAttributes<HTMLSpanElement> {
  /** Track size. Defaults to `sm`. */
  size?: IconCircleSize | undefined;
  /** `square` (`rounded-xs`) or `circle` (`rounded-cta`). Defaults to `circle`. */
  shape?: IconCircleShape | undefined;
  /** Fill + matching foreground, or an inherited-colour translucent fill. No default — a caller always has one in mind. */
  tone?: IconCircleTone | undefined;
  /** Glyph type size. Defaults to `sm`. */
  fontSize?: IconCircleFontSize | undefined;
  /** Glyph weight. Defaults to `normal`. */
  weight?: IconCircleWeight | undefined;
  /** `leading-none` — needed by the `+` glyph at `spot-tile.tsx:115` so a tall line-height doesn't push it off-centre. */
  leading?: 'none' | undefined;
}

/**
 * Every real call site is decorative — the glyph either repeats information
 * already in nearby text (a count, a state already named by a label) or is
 * pure ornament — so `aria-hidden` defaults to `true`. A caller with a
 * one-off case where the glyph *is* the only information can still pass
 * `aria-hidden={false}` (or any other ARIA) through the ordinary props.
 */
export const IconCircle = forwardRef<HTMLSpanElement, IconCircleProps>(function IconCircle(
  {
    size = 'sm',
    shape = 'circle',
    tone,
    fontSize = 'sm',
    weight = 'normal',
    leading,
    className,
    'aria-hidden': ariaHidden = true,
    children,
    ...rest
  },
  ref
) {
  return (
    <span
      {...rest}
      ref={ref}
      aria-hidden={ariaHidden}
      className={cx(
        'inline-flex shrink-0 items-center justify-center',
        SIZE_CLASSES[size],
        SHAPE_CLASSES[shape],
        tone && TONE_CLASSES[tone],
        FONT_SIZE_CLASSES[fontSize],
        WEIGHT_CLASSES[weight],
        leading === 'none' && 'leading-none',
        className
      )}
    >
      {children}
    </span>
  );
});
