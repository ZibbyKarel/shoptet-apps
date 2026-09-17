import { forwardRef, type HTMLAttributes, type Ref } from 'react';

import { cx } from '../cx';

/**
 * Every tag `Text` can render as. Deliberately excludes `h5`/`h6`'s siblings'
 * neighbours from nothing in particular — the app has no six-level heading
 * outline, but the type is kept exhaustive against the real HTML heading set
 * because trimming it buys nothing and would just have to grow back.
 */
export type TextAs =
  | 'p'
  | 'span'
  | 'div'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'strong'
  | 'label'
  | 'caption'
  | 'th'
  | 'td';

export type TextSize = 'xs' | 'sm' | 'base' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type TextWeight = 'normal' | 'medium' | 'bold';

/**
 * Every foreground colour the app actually draws text in, off the neutral
 * scale plus the two surface-specific pairings (`badge.tsx` explains why text
 * reads off neutrals rather than the saturated brand hues). The `inverse-*`
 * family is the text drawn on the dark asphalt surface of the parking map
 * (`lot-grid.tsx`'s `bg-neutral-950`-ish canvas), never on `--bg` — the alpha
 * steps (`/90` … `/50`) are literal opacity levels lifted straight off the
 * design, not a token scale, so they are spelled out one by one here rather
 * than derived.
 */
export type TextTone =
  | 'default'
  | 'muted'
  | 'subtle'
  | 'faint'
  | 'on-yellow'
  | 'on-green'
  | 'on-blue'
  | 'inverse'
  | 'inverse-90'
  | 'inverse-80'
  | 'inverse-70'
  | 'inverse-60'
  | 'inverse-50';

export type TextTracking = 'tight' | 'snug' | 'normal' | 'wide' | 'caps';
export type TextLeading = 'tight' | 'snug' | 'normal' | 'loose';
export type TextTransform = 'none' | 'uppercase';
export type TextAlign = 'start' | 'center' | 'end';
export type TextDisplay = 'inline' | 'block' | 'inline-flex';

const SIZE_CLASSES: Record<TextSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  md: 'text-md',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
};

const WEIGHT_CLASSES: Record<TextWeight, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  bold: 'font-bold',
};

/**
 * `faint` exists for exactly one call site — the recessed SO/NE weekend
 * column heads in the bulk modal (`bulk-modal.spec.tsx` asserts the literal
 * class `text-neutral-400`) — kept as its own tone rather than folded into
 * `subtle` so that call site reads as intentional, not as a rounding of
 * `--fg-3` that happened to land on a neutral step.
 */
const TONE_CLASSES: Record<TextTone, string> = {
  default: 'text-fg',
  muted: 'text-fg-2',
  subtle: 'text-fg-3',
  faint: 'text-neutral-400',
  'on-yellow': 'text-fg-on-yellow',
  'on-green': 'text-fg-on-green',
  'on-blue': 'text-fg-on-blue',
  inverse: 'text-neutral-0',
  'inverse-90': 'text-neutral-0/90',
  'inverse-80': 'text-neutral-0/80',
  'inverse-70': 'text-neutral-0/70',
  'inverse-60': 'text-neutral-0/60',
  'inverse-50': 'text-neutral-0/50',
};

const TRACKING_CLASSES: Record<TextTracking, string> = {
  tight: 'tracking-tight',
  snug: 'tracking-snug',
  normal: 'tracking-normal',
  wide: 'tracking-wide',
  caps: 'tracking-caps',
};

const LEADING_CLASSES: Record<TextLeading, string> = {
  tight: 'leading-tight',
  snug: 'leading-snug',
  normal: 'leading-normal',
  loose: 'leading-loose',
};

const ALIGN_CLASSES: Record<TextAlign, string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
};

const DISPLAY_CLASSES: Record<TextDisplay, string> = {
  inline: 'inline',
  block: 'block',
  'inline-flex': 'inline-flex',
};

export interface TextProps extends HTMLAttributes<HTMLElement> {
  /**
   * Tag rendered. **Defaults to `p`, not `span`.** Do not change this
   * default: two Playwright locators in
   * `apps/garage/web-e2e/src/admin-window.spec.ts` (`targetMonthRow` /
   * `rangeText`, lines 99 and 212) select `locator('p').nth(1)` and depend on
   * real `<p>` elements sitting in DOM order — a default of `span` would
   * silently break both without touching a single assertion string.
   */
  as?: TextAs | undefined;
  /** `text-*` size step. Undefined inherits the ambient size — emits no class. */
  size?: TextSize | undefined;
  /** `font-normal`/`font-medium`/`font-bold`. No dedicated weight token scale exists. */
  weight?: TextWeight | undefined;
  /** Foreground colour. See `TextTone` for the exact class each member maps to. */
  tone?: TextTone | undefined;
  /** `tracking-*` step. */
  tracking?: TextTracking | undefined;
  /** `leading-*` step. */
  leading?: TextLeading | undefined;
  /** `uppercase`, or `none` to explicitly force it off against an inherited transform. */
  transform?: TextTransform | undefined;
  /** `text-left`/`text-center`/`text-right`. */
  align?: TextAlign | undefined;
  /** `inline`/`block`/`inline-flex` — the app has several `<span className="block">`. */
  display?: TextDisplay | undefined;
  /** `truncate` (ellipsis on overflow; the caller still owns a width/max-width). */
  truncate?: boolean | undefined;
  /**
   * `scope` for `as="th"` (`col`/`row`/`colgroup`/`rowgroup`) — not part of
   * `HTMLAttributes`, which only covers the attributes every element shares.
   * Added alongside `th`/`td` in `TextAs` so a calendar column head
   * (`bulk-modal.tsx`, `date-picker-dialog.tsx`) can render `<Text as="th"
   * scope="col">` directly instead of nesting a styled `<span>` inside a
   * bare `<th>`. Not typed as `ThHTMLAttributes<HTMLElement>` on the whole
   * interface — that would offer `abbr`/`colSpan`/`rowSpan` on every other
   * tag too, for two real call sites that only ever need `scope`.
   */
  scope?: 'col' | 'row' | 'colgroup' | 'rowgroup' | undefined;
}

/**
 * Generic text primitive — headings, body copy, labels and captions all
 * render through this one component, parameterised by tag and by the visual
 * properties above instead of each screen hand-picking a bag of Tailwind
 * utilities. This is the replacement for the ~60% of app-layer Tailwind that
 * was just text styling.
 *
 * **Margin.** `Text` always emits `m-0`, unconditionally, regardless of
 * `as`. A heading or a `<p>` otherwise carries the user-agent stylesheet's
 * default margin, and this component's whole point is that vertical rhythm
 * is owned by `Stack`'s `spacing`/`Box`'s `margin` — never by an invisible
 * UA default a caller has to know to fight. Checked against the app's
 * current headings before deciding this (`grep '<h[1-6]' apps/garage/web/src`):
 * every one of them already sets its own `mt-*`/`mb-*`/`m-0` explicitly or
 * sits inside a `Stack`/flex gap, so none was relying on the UA default —
 * `brand.tsx`'s own `m-0` on its `<h1>`/`<span>` wordmark becomes redundant
 * once callers move to `Text`, not contradicted by it.
 */
export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  {
    as = 'p',
    size,
    weight,
    tone,
    tracking,
    leading,
    transform,
    align,
    display,
    truncate = false,
    className,
    children,
    ...rest
  },
  ref
) {
  const Component = as;

  // `as` is a union of a dozen intrinsic tags, so JSX infers the `ref` prop
  // as the *intersection* of every one of their specific ref types (a
  // `<label>` ref and an `<hr>` ref at once) — nothing satisfies that
  // except `never`. The cast is the polymorphic-component escape hatch: the
  // public signature above still promises callers a plain `HTMLElement`,
  // which every one of these tags is.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the polymorphic-`as` escape hatch, see above
  const componentRef = ref as Ref<any>;

  return (
    <Component
      {...rest}
      ref={componentRef}
      className={cx(
        'm-0',
        size !== undefined && SIZE_CLASSES[size],
        weight !== undefined && WEIGHT_CLASSES[weight],
        tone !== undefined && TONE_CLASSES[tone],
        tracking !== undefined && TRACKING_CLASSES[tracking],
        leading !== undefined && LEADING_CLASSES[leading],
        transform === 'uppercase' && 'uppercase',
        align !== undefined && ALIGN_CLASSES[align],
        display !== undefined && DISPLAY_CLASSES[display],
        truncate && 'truncate',
        className
      )}
    >
      {children}
    </Component>
  );
});
