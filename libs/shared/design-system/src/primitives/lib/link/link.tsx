import { forwardRef, type AnchorHTMLAttributes, type ElementType } from 'react';

import { FOCUS_RING } from '../control-size';
import { cx } from '../cx';

export type LinkSize = 'sm' | 'base';
export type LinkWeight = 'normal' | 'bold';

/**
 * `link` is today's only treatment, unchanged. `plain` was added for
 * `top-bar.tsx`'s wrap of the product logo (`Brand`): that call site needs
 * the focus ring and `rounded-sm` for keyboard users, but `link`'s
 * unconditional `text-brand-blue underline` would tint and underline the
 * whole logo, which is why the rewrite dropped the wrapper's classes
 * entirely and lost the focus ring — see the rewrite report. `plain` inherits
 * colour, draws no underline, and adds `inline-flex items-center` so a
 * caller wrapping a row of inline content (the logo's icon + wordmark) gets
 * sane layout without opting into either.
 */
export type LinkTone = 'link' | 'plain';

const SIZE_CLASSES: Record<LinkSize, string> = {
  sm: 'text-sm',
  base: 'text-base',
};

const WEIGHT_CLASSES: Record<LinkWeight, string> = {
  normal: 'font-normal',
  bold: 'font-bold',
};

const TONE_CLASSES: Record<LinkTone, string> = {
  link: 'text-brand-blue underline hover:text-brand-blue-700',
  plain: 'inline-flex items-center',
};

/**
 * `AnchorHTMLAttributes` is the widest reasonable prop surface even though
 * `as` can swap in a non-anchor component (`next/link`'s `Link`, which takes
 * an `href` too but not the rest of the DOM anchor attributes). Callers
 * passing a component with a narrower prop set get that component's own
 * typing at the JSX call site regardless of what this interface declares —
 * TypeScript checks the element created, not this generic prop bag.
 */
export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /**
   * What to render as. Defaults to a plain `<a>`; pass `next/link`'s `Link`
   * to keep client-side navigation while this lib still owns the styling —
   * `Button` cannot do this today because it always renders `<button>`.
   */
  as?: ElementType | undefined;
  /**
   * Type size. Defaults to `sm` for `tone="link"` — this default is skipped
   * entirely for `tone="plain"` (see `LinkTone` and the component body): a
   * plain-tone caller inherits its surrounding size unless it asks for one.
   */
  size?: LinkSize | undefined;
  /**
   * Weight. Defaults to `bold` for `tone="link"` — same skip as `size` for
   * `tone="plain"`.
   */
  weight?: LinkWeight | undefined;
  /** Visual treatment. Defaults to `link`, today's only (and unchanged) appearance. */
  tone?: LinkTone | undefined;
}

/**
 * The product's one text-link treatment — underlined, brand blue, bold by
 * default. Kept deliberately thin on polymorphism: `as` takes any
 * `ElementType` and every other prop spreads straight through, no `asChild`
 * indirection and no generic prop-inference for a single call site
 * (`NotFound`'s "back to the lot" link) to earn.
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { as: Component = 'a', tone = 'link', size, weight, className, ...rest },
  ref
) {
  // `size`/`weight` cannot use a signature default the way every other prop
  // here does: `tone="plain"` must render with neither (that is the whole
  // point — a logo wrapped in a plain link must not shrink or embolden),
  // while `tone="link"` must go on emitting them exactly as before this prop
  // existed. Resolving them here, conditional on `tone`, keeps both true.
  const resolvedSize = size ?? (tone === 'link' ? 'sm' : undefined);
  const resolvedWeight = weight ?? (tone === 'link' ? 'bold' : undefined);

  return (
    <Component
      {...rest}
      ref={ref}
      className={cx(
        'rounded-sm',
        TONE_CLASSES[tone],
        resolvedSize !== undefined && SIZE_CLASSES[resolvedSize],
        resolvedWeight !== undefined && WEIGHT_CLASSES[resolvedWeight],
        FOCUS_RING,
        className
      )}
    />
  );
});
