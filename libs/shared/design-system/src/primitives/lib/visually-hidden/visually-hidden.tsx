import { forwardRef, type HTMLAttributes, type Ref } from 'react';

import { cx } from '../cx';

export type VisuallyHiddenAs = 'span' | 'div' | 'caption' | 'h1' | 'h2' | 'legend';

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLElement> {
  /** Tag rendered. Defaults to `span`. */
  as?: VisuallyHiddenAs | undefined;
}

/**
 * Content present for assistive tech and absent from the rendered page —
 * `admin-spots-screen.spec.tsx` (`names the actions column for a screen
 * reader while leaving it blank on screen`) is exactly this pattern:
 * `lot-header.tsx`'s `<h1 className="sr-only">` is another.
 *
 * **Must emit the literal class `sr-only` and nothing else by default.**
 * `admin-spots-screen.spec.tsx:565` asserts `toHaveClass('sr-only')` directly
 * — that string is load-bearing, not an implementation detail this
 * component is free to swap for an equivalent clip-rect. `sr-only` is
 * Tailwind's own utility (`position:absolute; width:1px; height:1px;
 * overflow:hidden; clip-path:inset(50%); …`), not a token from this design
 * system, so there is no `SR_ONLY_CLASSES` table to vary by `as` — the class
 * is the same regardless of which tag it lands on.
 */
export const VisuallyHidden = forwardRef<HTMLElement, VisuallyHiddenProps>(function VisuallyHidden(
  { as = 'span', className, children, ...rest },
  ref
) {
  const Component = as;

  // Same polymorphic-`as` situation as `Text` — see the comment there.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the polymorphic-`as` escape hatch, see above
  const componentRef = ref as Ref<any>;

  return (
    <Component {...rest} ref={componentRef} className={cx('sr-only', className)}>
      {children}
    </Component>
  );
});
