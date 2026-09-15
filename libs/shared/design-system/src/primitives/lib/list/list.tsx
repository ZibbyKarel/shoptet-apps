'use client';

import {
  createContext,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type LiHTMLAttributes,
  type Ref,
} from 'react';

import { cx } from '../cx';
import { resolveGap } from '../gap';
import { resolvePadding, type Padding } from '../padding';
import type { SpacingKey } from '@lets-park/design-system/tokens';
import type { StackAlign, StackDirection, StackJustify } from '../stack/stack';

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

export type ListMarker = 'none' | 'disc';
export type ListDivider = 'none' | 'line';

const MARKER_CLASSES: Record<ListMarker, string> = {
  none: 'list-none',
  disc: 'list-disc',
};

/**
 * Whether the enclosing `List` wants a line under every item. Read by
 * `ListItem` and defaulting to `'none'` so a bare `<ListItem>` rendered
 * outside a `List` (e.g. in isolation in a story or a test) still works —
 * it just never grows the divider border.
 */
const ListDividerContext = createContext<ListDivider>('none');

export interface ListProps extends HTMLAttributes<HTMLUListElement | HTMLOListElement> {
  /** `<ul>` or `<ol>`. Defaults to `'ul'`. */
  as?: 'ul' | 'ol' | undefined;
  /** Flex axis for laying out the `<li>` children. Defaults to `column`. */
  direction?: StackDirection | undefined;
  /** Gap between items (`gap-{n}`), same vocabulary as `Stack`. */
  spacing?: SpacingKey | undefined;
  /** Cross-axis alignment (`items-*`). */
  align?: StackAlign | undefined;
  /** Main-axis alignment (`justify-*`). */
  justify?: StackJustify | undefined;
  /** `flex-wrap`. */
  wrap?: boolean | undefined;
  /** `list-style`. Defaults to `'none'` — feature code opts into `disc` explicitly. */
  marker?: ListMarker | undefined;
  /**
   * `'line'` puts a bottom border on every `<li>` (removed on the last one),
   * mirroring what `admin-window-screen.tsx`'s `MonthRow` does by hand today
   * (`border-b border-divider ... last:border-b-0`). Read by `ListItem` via
   * context rather than passed as a prop on each item, so the list owns the
   * decision once instead of every call site repeating it.
   */
  divider?: ListDivider | undefined;
}

/**
 * `<ul>`/`<ol>` with `Stack`'s gap/align/justify/wrap surface.
 *
 * `Stack` itself cannot stand in for this: it always renders a `<div>`, and
 * `apps/lets-park/web-e2e/src/admin-window.spec.ts` locates rows with
 * `getByRole('listitem')` — a `<div>` carries no implicit `listitem` role, so
 * the e2e suite would simply find nothing. `List`/`ListItem` render real
 * `<ul>`/`<ol>`/`<li>` so that role exists for free, replacing the
 * hand-rolled `<ul className="flex flex-col gap-2">` / `<li className="...">`
 * pairs scattered across `apps/lets-park/web`.
 */
export const List = forwardRef<HTMLUListElement | HTMLOListElement, ListProps>(function List(
  {
    as = 'ul',
    direction = 'column',
    spacing,
    align,
    justify,
    wrap = false,
    marker = 'none',
    divider = 'none',
    className,
    children,
    ...rest
  },
  ref
) {
  const Tag = as;

  return (
    <ListDividerContext.Provider value={divider}>
      <Tag
        {...rest}
        // `Tag` is a union of two intrinsic element types, and JSX resolves
        // `ref`'s type per-branch rather than against the union `forwardRef`
        // was given — same shape as the cast `Divider` needs for its two
        // element types. The cast is safe: `Tag` and `ref`'s target always
        // agree, driven by the same `as` prop.
        ref={ref as Ref<HTMLUListElement> & Ref<HTMLOListElement>}
        className={cx(
          // `<ul>`/`<ol>` carry a user-agent margin and padding; zeroing both
          // here means `spacing` is the only thing that ever controls the
          // gap between items, same as every other spacing prop in this
          // library — no invisible UA spacing stacking on top of it.
          'm-0 flex list-none p-0',
          MARKER_CLASSES[marker],
          DIRECTION_CLASSES[direction],
          spacing !== undefined && resolveGap(spacing),
          align && ALIGN_CLASSES[align],
          justify && JUSTIFY_CLASSES[justify],
          wrap && 'flex-wrap',
          className
        )}
      >
        {children}
      </Tag>
    </ListDividerContext.Provider>
  );
});

export interface ListItemProps extends LiHTMLAttributes<HTMLLIElement> {
  /** `p-*`/`py-*`+`px-*`/`pt-*`+`pr-*`+`pb-*`+`pl-*`, see `Padding`. */
  padding?: Padding | undefined;
  /** Lays out this item's own contents, so a row item needs no inner `Stack`. */
  direction?: StackDirection | undefined;
  /** Gap between this item's own children. */
  spacing?: SpacingKey | undefined;
  /** Cross-axis alignment of this item's own children. */
  align?: StackAlign | undefined;
  /** Main-axis alignment of this item's own children. */
  justify?: StackJustify | undefined;
  /** `flex-wrap` for this item's own children. */
  wrap?: boolean | undefined;
}

/**
 * A `<li>`. Reads `divider` off the nearest `List` via context, so the
 * `border-b border-divider last:border-b-0` pair lands on the `<li>` itself
 * — not a wrapper — matching what the e2e locator expects
 * (`getByRole('listitem')` then `.locator('p')` directly inside it). Works
 * standalone (no divider, no layout classes) when rendered outside a `List`.
 */
export const ListItem = forwardRef<HTMLLIElement, ListItemProps>(function ListItem(
  { padding, direction, spacing, align, justify, wrap = false, className, children, ...rest },
  ref
) {
  const divider = useContext(ListDividerContext);
  const hasLayout =
    direction !== undefined ||
    spacing !== undefined ||
    align !== undefined ||
    justify !== undefined ||
    wrap;

  return (
    <li
      {...rest}
      ref={ref}
      className={cx(
        hasLayout && 'flex',
        hasLayout && DIRECTION_CLASSES[direction ?? 'row'],
        padding !== undefined && resolvePadding(padding, 'p'),
        spacing !== undefined && resolveGap(spacing),
        align && ALIGN_CLASSES[align],
        justify && JUSTIFY_CLASSES[justify],
        wrap && 'flex-wrap',
        divider === 'line' && 'border-b border-divider last:border-b-0',
        className
      )}
    >
      {children}
    </li>
  );
});
