import { forwardRef, type HTMLAttributes } from 'react';

import { cx } from '../cx';
import type { SpacingKey } from '@garage/design-system/tokens';

/**
 * `w-{n}`/`h-{n}` literals for a fixed-size `Spacer`, enumerated for the same
 * reason as `PADDING_CLASSES`/`GAP_CLASSES`: Tailwind v4 scans source text
 * statically, so a template like `` `w-${step}` `` would emit no CSS. Both
 * axes are set together — `Spacer` does not know whether its flex parent
 * (`Stack`) runs `row` or `column`, so a fixed size has to hold along
 * whichever axis actually stretches; `shrink-0` on the element (not in this
 * map, applied directly in JSX) keeps the other axis from collapsing it.
 */
const SIZE_CLASSES: Record<SpacingKey, { width: string; height: string }> = {
  1: { width: 'w-1', height: 'h-1' },
  2: { width: 'w-2', height: 'h-2' },
  3: { width: 'w-3', height: 'h-3' },
  4: { width: 'w-4', height: 'h-4' },
  5: { width: 'w-5', height: 'h-5' },
  6: { width: 'w-6', height: 'h-6' },
  8: { width: 'w-8', height: 'h-8' },
  10: { width: 'w-10', height: 'h-10' },
  12: { width: 'w-12', height: 'h-12' },
  16: { width: 'w-16', height: 'h-16' },
  20: { width: 'w-20', height: 'h-20' },
  24: { width: 'w-24', height: 'h-24' },
  32: { width: 'w-32', height: 'h-32' },
};

export interface SpacerProps extends HTMLAttributes<HTMLDivElement> {
  /** Fixed width/height (`w-{n} h-{n}`). Without it, the spacer grows (`flex-1`) instead. */
  size?: SpacingKey | undefined;
}

/**
 * Purely decorative gap inside a flex row/column — e.g. pushing toolbar
 * items apart. Always `aria-hidden`: it carries no content and must never be
 * announced.
 */
export const Spacer = forwardRef<HTMLDivElement, SpacerProps>(function Spacer(
  { size, className, ...rest },
  ref
) {
  return (
    <div
      {...rest}
      ref={ref}
      aria-hidden="true"
      className={cx(
        size === undefined
          ? 'flex-1'
          : cx('shrink-0', SIZE_CLASSES[size].width, SIZE_CLASSES[size].height),
        className
      )}
    />
  );
});
