import { forwardRef, type HTMLAttributes, type Ref } from 'react';

import { cx } from '../cx';
import { PADDING_CLASSES } from '../padding';
import type { SpacingKey } from '@garage/design-system/tokens';

export type DividerOrientation = 'horizontal' | 'vertical';
export type DividerTone = 'border' | 'divider';

const TONE_CLASSES: Record<DividerTone, string> = {
  border: 'border-border',
  divider: 'border-divider',
};

export interface DividerProps extends HTMLAttributes<HTMLElement> {
  /** Line axis. Defaults to `horizontal`. */
  orientation?: DividerOrientation | undefined;
  /** Which of the two border-color tokens `apps/garage/web` uses today. Defaults to `border`. */
  tone?: DividerTone | undefined;
  /**
   * Margin *perpendicular* to the line: `my-*` for a horizontal divider
   * (space above/below the line), `mx-*` for a vertical one (space to its
   * left/right).
   */
  spacing?: SpacingKey | undefined;
}

/**
 * Thin rule replacing `border-t`/`border-b` `border-border`/`border-divider`
 * (7 occurrences in `apps/garage/web`).
 *
 * Renders a real `<hr>` for the horizontal case — it already carries the
 * separator semantics and needs no ARIA. A vertical rule has no native HTML
 * element, so it falls back to a `<div role="separator" aria-orientation="vertical">`,
 * which is the documented way to give a non-`<hr>` element the same meaning.
 */
export const Divider = forwardRef<HTMLElement, DividerProps>(function Divider(
  { orientation = 'horizontal', tone = 'border', spacing, className, ...rest },
  ref
) {
  const spacingClass =
    spacing === undefined
      ? undefined
      : PADDING_CLASSES[orientation === 'horizontal' ? 'my' : 'mx'][spacing];

  if (orientation === 'vertical') {
    return (
      <div
        {...rest}
        ref={ref as Ref<HTMLDivElement>}
        role="separator"
        aria-orientation="vertical"
        className={cx(
          // One mechanism, not three: `border-l` alone supplies both the
          // line's 1px width (this div has no content, so its content-box
          // width is 0 and the border is all that renders) and its color via
          // `TONE_CLASSES`, so a separate `w-px` would just be claiming the
          // same pixel a second time. `self-stretch` fills the parent's
          // cross-axis height inside a flex container (e.g. `Stack`), which
          // is the only context a vertical divider is meant for — `h-full`
          // would either do nothing (unsized parent) or fight it.
          'self-stretch border-l',
          TONE_CLASSES[tone],
          spacingClass,
          className
        )}
      />
    );
  }

  return (
    <hr
      {...rest}
      ref={ref as Ref<HTMLHRElement>}
      // `border-t` is not redundant with Tailwind's preflight, even though
      // preflight's own `hr` rule (`tailwindcss/preflight.css`) already sets
      // `border-top-width: 1px` (plus `height: 0` and `color: inherit`, which
      // makes the border color default to `currentColor`): explicit here
      // beats inherited-from-preflight, because this component must not
      // silently change appearance if a consuming app's global CSS resets
      // `hr` differently or omits preflight altogether. `TONE_CLASSES` sets
      // `border-color` regardless — that part was never resting on preflight.
      // `w-full` is not redundant either: a bare block-level `<hr>` fills its
      // container's width on its own, but only under the *default* flex
      // cross-axis alignment (`align-items: stretch`); a `Stack` rendered
      // with `align="center"`/`"start"`/`"end"` turns that off, and an
      // `<hr>` with no explicit width then shrinks to its (empty) intrinsic
      // width — effectively invisible. `w-full` keeps the rule visible
      // regardless of the parent's `align`.
      className={cx('w-full border-t', TONE_CLASSES[tone], spacingClass, className)}
    />
  );
});
