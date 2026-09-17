import { forwardRef, type HTMLAttributes, type Ref } from 'react';

import { cx } from '../cx';

/**
 * Fixed-height, pill-shaped label — the shape `apps/garage/web` currently
 * hand-rolls at three call sites (an admin day-view legend chip, the lot
 * header's filter pill, and the admin spots screen's category band). All
 * three share `rounded-cta` + `gap-2` + a border-or-muted surface; they
 * differ only in track height and type size.
 */
export type ChipSize = 'sm' | 'md' | 'lg';
export type ChipTone = 'outline' | 'muted';
export type ChipWeight = 'normal' | 'medium';
export type ChipDot = 'none' | 'green' | 'blue';
/**
 * `lot-header.tsx:94` renders its chip as a `<p>` today, not a `<span>`. `'p'`
 * is supported for that call site; `'div'` for anywhere a chip needs to be a
 * block-level container of other block content.
 */
export type ChipAs = 'span' | 'div' | 'p';

/**
 * Height + horizontal padding + type size, read verbatim off the three real
 * call sites. **`md` and `lg` are not a monotonic scale** — `md`
 * (`lot-header.tsx:94`) is taller than `lg` (`admin-day-screen.tsx:163`) but
 * uses the *larger* type size (`text-base` vs `text-sm`). That is how the
 * design actually renders today; harmonising it would drift from the pixels
 * this component exists to reproduce.
 */
const SIZE_CLASSES: Record<ChipSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-4 text-base',
  lg: 'h-10 px-4 text-sm',
};

const TONE_CLASSES: Record<ChipTone, string> = {
  outline: 'border border-border bg-bg',
  muted: 'bg-bg-muted',
};

const WEIGHT_CLASSES: Record<ChipWeight, string> = {
  normal: '',
  medium: 'font-medium',
};

/** Leading-dot fill. Only the two tones the real call site (`admin-day-screen.tsx:163`) switches between. */
const DOT_CLASSES: Record<Exclude<ChipDot, 'none'>, string> = {
  green: 'bg-brand-green',
  blue: 'bg-brand-blue',
};

export interface ChipProps extends HTMLAttributes<HTMLElement> {
  /** Track height + padding + type size. Defaults to `md`. */
  size?: ChipSize | undefined;
  /** Bordered-on-`bg` vs a flat muted fill. Defaults to `outline`. */
  tone?: ChipTone | undefined;
  /** Label weight. Defaults to `normal`. */
  weight?: ChipWeight | undefined;
  /** Leading status dot, or none. Defaults to `none`. */
  dot?: ChipDot | undefined;
  /** Rendered element. Defaults to `span`. */
  as?: ChipAs | undefined;
}

/**
 * Small pill for a filter/legend/category label — a fixed-height sibling of
 * `Badge` (which is unbounded-height, purely decorative text). A `Chip` can
 * carry a leading status dot and/or a trailing count as ordinary children;
 * neither needs its own prop.
 *
 * `forwardRef`, unlike `Badge`: real call sites already attach handlers
 * (`lot-header.tsx`'s chip sits inside a button group) where a caller may
 * need the node.
 */
export const Chip = forwardRef<HTMLElement, ChipProps>(function Chip(
  {
    size = 'md',
    tone = 'outline',
    weight = 'normal',
    dot = 'none',
    as = 'span',
    className,
    children,
    ...rest
  },
  ref
) {
  const classes = cx(
    // `inline-flex` throughout, even though `lot-header.tsx:94` and
    // `spot-tile.tsx` (see `IconCircle`) render `flex` at the real call
    // site — in both cases the element is a flex *item* inside another
    // flex row, where its own width is already constrained by that
    // parent, so `inline-flex` renders identically while staying correct
    // for a chip used on its own (sized to its content, not to a block).
    'inline-flex items-center gap-2 rounded-cta text-fg',
    SIZE_CLASSES[size],
    TONE_CLASSES[tone],
    WEIGHT_CLASSES[weight],
    className
  );

  const leadingDot =
    dot === 'none' ? null : (
      <span aria-hidden="true" className={cx('size-2 rounded-cta', DOT_CLASSES[dot])} />
    );

  if (as === 'div') {
    return (
      <div {...rest} ref={ref as Ref<HTMLDivElement>} className={classes}>
        {leadingDot}
        {children}
      </div>
    );
  }

  if (as === 'p') {
    return (
      <p {...rest} ref={ref as Ref<HTMLParagraphElement>} className={classes}>
        {leadingDot}
        {children}
      </p>
    );
  }

  return (
    <span {...rest} ref={ref as Ref<HTMLSpanElement>} className={classes}>
      {leadingDot}
      {children}
    </span>
  );
});
