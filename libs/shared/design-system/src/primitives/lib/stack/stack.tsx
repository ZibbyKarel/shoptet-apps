import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';

import { cx } from '../cx';
import { resolveGap, resolveGapX, resolveGapY } from '../gap';
import type { SpacingKey } from '@lets-park/design-system/tokens';

export type StackDirection = 'row' | 'column';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type StackJustify = 'start' | 'center' | 'end' | 'between' | 'around';

/**
 * Elements a `Stack` may render as — same tag set and same rationale as
 * `Box`'s `as` (`box.tsx`): every one of these accepts the same flex-container
 * classes, so there is no per-tag branching beyond which string JSX renders.
 */
export type StackAs =
  | 'div'
  | 'section'
  | 'header'
  | 'footer'
  | 'main'
  | 'nav'
  | 'aside'
  | 'article'
  | 'span';

export type StackMinHeight = 'viewport';

/** `min-h-dvh` — a full-viewport centring wrapper (`login-screen.tsx`). */
const MIN_HEIGHT_CLASSES: Record<StackMinHeight, string> = {
  viewport: 'min-h-dvh',
};

export type StackHeight = 'full';

/**
 * `h-full` — makes the flex container fill its parent's height instead of
 * sizing to its own content. The app shell's header (`top-bar.tsx`) is a
 * fixed-height `Box` (`height="bar"`, `h-16`) wrapping a row `Stack`; without
 * this the `Stack` sits at its content height at the *top* of the box, so
 * `align="center"` has no real height to centre against. Named to match
 * `minHeight`/`BoxHeight` rather than a new `fillHeight`-shaped prop.
 */
const HEIGHT_CLASSES: Record<StackHeight, string> = {
  full: 'h-full',
};

const DIRECTION_CLASSES: Record<StackDirection, string> = {
  row: 'flex-row',
  column: 'flex-col',
};

const ALIGN_CLASSES: Record<StackAlign, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
};

const JUSTIFY_CLASSES: Record<StackJustify, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
};

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** Which element to render. Defaults to `div`. */
  as?: StackAs | undefined;
  /** Flex axis. Defaults to `column`. */
  direction?: StackDirection | undefined;
  /** Gap between children (`gap-{n}`). Overridden per axis by `spacingX`/`spacingY`. */
  spacing?: SpacingKey | undefined;
  /**
   * Overrides `spacing` on the horizontal axis only (`gap-x-{n}`) — for a
   * row that needs a different gap once it wraps onto more than one line,
   * e.g. `bulk-modal.tsx`'s footnote row (`gap-x-4 gap-y-1`).
   */
  spacingX?: SpacingKey | undefined;
  /** Overrides `spacing` on the vertical axis only (`gap-y-{n}`) — see `spacingX`. */
  spacingY?: SpacingKey | undefined;
  /** Cross-axis alignment (`items-*`). */
  align?: StackAlign | undefined;
  /** Main-axis alignment (`justify-*`). */
  justify?: StackJustify | undefined;
  /** `flex-wrap`. */
  wrap?: boolean | undefined;
  /** `min-h-dvh` — a full-viewport centring wrapper. */
  minHeight?: StackMinHeight | undefined;
  /** `h-full` — fills the parent's height, so `align` centres against the real height. */
  height?: StackHeight | undefined;
  /**
   * Rendered between every pair of children — typically a `<Divider>`. Each
   * copy gets its own key; `undefined`/`null` children are skipped first, so
   * a divider never lands next to a gap where a nullish child was.
   */
  divider?: ReactNode | undefined;
}

/**
 * Flex row/column with a gap, replacing `flex flex-col gap-*` and
 * `flex items-center gap-*` (30+ occurrences in `apps/lets-park/web`).
 */
export const Stack = forwardRef<HTMLElement, StackProps>(function Stack(
  {
    as: Component = 'div',
    direction = 'column',
    spacing,
    spacingX,
    spacingY,
    align,
    justify,
    wrap = false,
    minHeight,
    height,
    divider,
    className,
    children,
    ...rest
  },
  ref
) {
  // `Children.toArray` drops nullish/boolean children and assigns each
  // survivor a stable key (either its own explicit `key`, or a
  // position-derived one it generates). The wrapper below must read that key
  // back off the element — re-keying by array index here would defeat the
  // whole point: on a reorder, React would match wrappers by position
  // instead of by identity, and any uncontrolled state inside a child would
  // jump to whichever child now sits at that position instead of following
  // the child it belonged to.
  const items = Children.toArray(children);

  return (
    <Component
      {...rest}
      // Cast for the same reason as `Box`'s: `Component` is a union of
      // intrinsic tags, each with its own unrelated `ref` element type, and
      // TS cannot narrow that union from a runtime-chosen string.
      ref={ref as Ref<HTMLDivElement>}
      className={cx(
        'flex',
        DIRECTION_CLASSES[direction],
        spacing !== undefined && resolveGap(spacing),
        // Applied after `spacing` so an axis override wins: Tailwind's
        // generated stylesheet orders `gap-x-*`/`gap-y-*` (longhand
        // `column-gap`/`row-gap`) after the `gap-*` shorthand regardless of
        // the order these classes appear in `className`, so this is really
        // about reading intent here, not CSS cascade order.
        spacingX !== undefined && resolveGapX(spacingX),
        spacingY !== undefined && resolveGapY(spacingY),
        align && ALIGN_CLASSES[align],
        justify && JUSTIFY_CLASSES[justify],
        wrap && 'flex-wrap',
        minHeight && MIN_HEIGHT_CLASSES[minHeight],
        height && HEIGHT_CLASSES[height],
        className
      )}
    >
      {divider
        ? items.map((child, index) => {
            const key = isValidElement(child) ? child.key : null;

            return (
              <Fragment key={key ?? index}>
                {index > 0 ? divider : null}
                {child}
              </Fragment>
            );
          })
        : items}
    </Component>
  );
});
