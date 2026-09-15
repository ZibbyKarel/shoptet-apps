import type { HTMLAttributes } from 'react';

import { cx } from '../cx';

/**
 * Badge colour pairs, straight off the design's status pills. Each tone is a
 * tint background with a darker foreground — never a saturated fill.
 *
 * **The tint carries the tone; the text does not.** Badge copy is 12px, so
 * WCAG 2.1 AA wants 4.5:1, and the design's own saturated hues do not reach it
 * on their matching 100-level tint — measured from `assets/tokens.css`:
 * `--brand-green-700` on `--brand-green-100` is 2.31:1, `--brand-blue` on
 * `--brand-blue-100` is 2.88:1, `--danger` on `--danger-100` is 3.26:1, and
 * even the `-700` step does not rescue them (`--brand-blue-700` on the blue
 * tint is 4.29:1, `--brand-yellow-700` on the yellow tint 1.93:1). So every
 * tone reads its text off the neutral foreground scale and lets the background
 * say which tone it is: `--fg-2` on each tint is 8.69–9.50:1, and `warning`
 * keeps `--fg-on-yellow` (14.49:1), the token the design pairs with yellow.
 *
 * See `doc/decision/0266-badge-avatar-and-toast-read-their-text-off-the-neutral-scale.md`.
 *
 * `tag` is the exception to "the tint carries the tone": it is not a status
 * colour at all, it is the product's one "GUEST" label
 * (`SpotDialog`/`AdminDayScreen`/`AdminSpotsScreen`), always yellow, always
 * `--fg` rather than `--fg-2` — measured at 16.19:1 on `--brand-yellow-100`,
 * comfortably clear of the 4.5:1 AA floor `contrast.spec.tsx` checks every
 * tone against.
 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'tag';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-bg-muted text-fg-2',
  info: 'bg-brand-blue-100 text-fg-2',
  success: 'bg-brand-green-100 text-fg-2',
  warning: 'bg-brand-yellow-100 text-fg-on-yellow',
  danger: 'bg-danger-100 text-fg-2',
  tag: 'bg-brand-yellow-100 text-fg',
};

/**
 * Size step. `md` is every badge shipped before this prop existed, byte-for-
 * byte — nothing here may change its output. `sm` is the smaller "tag" pill
 * three call sites hand-rolled identically; colour is not part of the size
 * step (that is still `tone`), only shape.
 */
export type BadgeSize = 'sm' | 'md';

const SIZE_CLASSES: Record<BadgeSize, string> = {
  md: 'h-6 rounded-cta px-3 text-xs font-bold whitespace-nowrap',
  sm: 'rounded-xs px-2 py-0.5 text-xs font-bold uppercase tracking-caps',
};

/**
 * Forces the label's case independently of `size` — `top-bar.tsx` wants an
 * uppercase "ADMIN" badge at the ordinary `md` size, which `sm`'s baked-in
 * `uppercase tracking-caps` cannot give it without also shrinking the pill.
 */
export type BadgeTransform = 'none' | 'uppercase';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Colour pair. Defaults to `neutral`. */
  tone?: BadgeTone | undefined;
  /** Shape/height step. Defaults to `md`, today's only shape. */
  size?: BadgeSize | undefined;
  /** Forces uppercase + caps tracking. Defaults to `none`. */
  transform?: BadgeTransform | undefined;
}

/**
 * Small pill label for a state or a count.
 *
 * Purely decorative markup — a `<span>` with no role. When the badge carries
 * information that is not repeated in nearby text, the caller is responsible
 * for exposing it (an `aria-label` on the surrounding element, or a visually
 * hidden sentence); a badge cannot know that on its own.
 */
export function Badge({
  tone = 'neutral',
  size = 'md',
  transform = 'none',
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={cx(
        'inline-flex items-center',
        SIZE_CLASSES[size],
        TONE_CLASSES[tone],
        transform === 'uppercase' && 'uppercase tracking-caps',
        className
      )}
    >
      {children}
    </span>
  );
}
