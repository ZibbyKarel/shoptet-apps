import { forwardRef, type HTMLAttributes } from 'react';

import { cx } from '../cx';
import { resolveGap } from '../gap';
import type { SpacingKey } from '@garage/design-system/tokens';

export type GridColumns = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * `grid-cols-{n}` literals, spelled out for the same reason as
 * `PADDING_CLASSES`/`GAP_CLASSES`: Tailwind v4 scans source text statically,
 * so `` `grid-cols-${n}` `` would emit no CSS.
 */
const BASE_COLUMNS_CLASSES: Record<GridColumns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
};

/** `md:grid-cols-{n}` literals — same rationale, and a separate table because the `md:` variant is its own literal. */
const MD_COLUMNS_CLASSES: Record<GridColumns, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
  6: 'md:grid-cols-6',
};

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Column count, either fixed or responsive (`{ base, md }`). Replaces
   * `grid gap-6 md:grid-cols-2` (`admin-window-screen.tsx:106`).
   */
  columns: GridColumns | { base: GridColumns; md?: GridColumns | undefined };
  /** Gap between cells (`gap-{n}`), reusing `resolveGap` from `gap.ts`. */
  spacing?: SpacingKey | undefined;
}

/**
 * CSS grid with a column count and gap, replacing the one existing
 * `grid gap-6 md:grid-cols-2` occurrence and providing responsive
 * multi-column layout for future ones.
 */
export const Grid = forwardRef<HTMLDivElement, GridProps>(function Grid(
  { columns, spacing, className, children, ...rest },
  ref
) {
  const base = typeof columns === 'number' ? columns : columns.base;
  const md = typeof columns === 'number' ? undefined : columns.md;

  return (
    <div
      {...rest}
      ref={ref}
      className={cx(
        'grid',
        BASE_COLUMNS_CLASSES[base],
        md !== undefined && MD_COLUMNS_CLASSES[md],
        spacing !== undefined && resolveGap(spacing),
        className
      )}
    >
      {children}
    </div>
  );
});
