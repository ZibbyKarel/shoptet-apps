import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { FOCUS_RING } from '../control-size';
import { cx } from '../cx';

/**
 * Two chrome families this one state machine dresses up as:
 *
 * - `cell` — a day in a calendar grid (`BulkModal`'s multi-day picker,
 *   `DatePickerDialog`'s single-day picker). Square-ish, full width of its
 *   `<td>`, and its "not selectable" state is a *blocked day*, not merely
 *   an unselected one — different chrome, not just a dimmer selected one.
 * - `pill` — one option of a segmented control (`LockModeChoice`). Inline,
 *   rounded, and its inactive state is a genuinely `disabled` control, not a
 *   day the calendar refuses to let you pick.
 *
 * Both were hand-rolled at their call sites with the same three-state shape
 * (selected / selectable-but-unselected / not-interactive) and slightly
 * different class strings — this centralises the shape and lets the two
 * chrome families keep diverging on look.
 */
export type ToggleTileShape = 'cell' | 'pill';

/**
 * `transition`/`duration`/`ease` utilities, or none. The two calendars that
 * use `shape="cell"` disagree on this: `BulkModal`'s grid animates the
 * selected/unselected swap, `DatePickerDialog`'s does not. Rather than pick a
 * winner, it is a prop — `'none'` is the honest default, since a tile that
 * says nothing about motion should not silently start animating.
 */
export type ToggleTileTransition = 'none' | 'base' | 'fast';

const TRANSITION_CLASSES: Record<ToggleTileTransition, string> = {
  none: '',
  base: 'transition duration-[var(--dur-base)] ease-out',
  fast: 'transition duration-[var(--dur-fast)] ease-out',
};

const CELL_BASE = 'h-[var(--control-h-lg)] w-full rounded-sm border text-base font-bold';
const CELL_SELECTED = 'cursor-pointer border-brand-blue bg-brand-blue text-fg-on-blue';
const CELL_UNSELECTED = 'cursor-pointer border-border bg-bg text-fg hover:bg-bg-muted';
/** The blocked-day state: no border, no pointer, dimmed onto `--bg-soft`. */
const CELL_INACTIVE = 'cursor-default border-transparent bg-bg-soft text-fg-3';

const PILL_BASE = 'inline-flex h-11 items-center rounded-cta border px-5 text-sm';
const PILL_SELECTED = 'cursor-pointer border-transparent bg-brand-blue font-bold text-fg-on-blue';
const PILL_UNSELECTED =
  'cursor-pointer border-border bg-bg font-medium text-fg hover:border-brand-dark';
/**
 * `text-fg-3`, not `text-border-strong`: the latter is the exact pairing
 * `contrast.spec.tsx`'s `DISABLED_FLOOR` comment names as a fixed historical
 * bug (`--border-strong` on `--bg-muted` measures 1.38:1, below even the 3:1
 * floor for a disabled control) — the same failure `CELL_INACTIVE` above
 * avoids by already using `text-fg-3` (4.40:1 on this background).
 */
const PILL_INACTIVE = 'cursor-not-allowed border-border bg-bg-muted font-medium text-fg-3';

export interface ToggleTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Which chrome family to render. Defaults to `'cell'`. */
  shape?: ToggleTileShape | undefined;
  /** Whether this tile is the current selection. */
  selected?: boolean | undefined;
  /**
   * Whether this tile can be picked at all. Defaults to `true`. `false` is
   * the calendar's "blocked day" — non-interactive chrome, distinct from
   * "selectable but not currently selected". Combines with native `disabled`
   * (either one flips the tile to its inactive state).
   */
  selectable?: boolean | undefined;
  /** Motion, or none. Defaults to `'none'` — see `ToggleTileTransition`. */
  transition?: ToggleTileTransition | undefined;
}

/**
 * A single option in a selected/unselected/disabled button-group — a day
 * cell in a calendar grid, or a pill in a segmented control.
 *
 * Always a real `<button>`, never a styled `<div>`: Enter/Space and the
 * disabled state come from the platform. `role="radio"` + `aria-checked`
 * pass straight through `...rest` for callers driving a roving-tabindex
 * radio group (`LockModeChoice`) — this component only owns the visual state
 * machine, not the group's keyboard semantics.
 */
export const ToggleTile = forwardRef<HTMLButtonElement, ToggleTileProps>(function ToggleTile(
  {
    shape = 'cell',
    selected = false,
    selectable = true,
    transition = 'none',
    disabled = false,
    type = 'button',
    className,
    children,
    ...rest
  },
  ref
) {
  // Either flag is enough to make the tile non-interactive; a caller that
  // only knows "selectable" (the calendars) and one that only knows
  // "disabled" (the segmented control) both land on the same inactive state.
  const isInactive = disabled || !selectable;

  const stateClasses =
    shape === 'cell'
      ? isInactive
        ? CELL_INACTIVE
        : selected
          ? CELL_SELECTED
          : CELL_UNSELECTED
      : isInactive
        ? PILL_INACTIVE
        : selected
          ? PILL_SELECTED
          : PILL_UNSELECTED;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={isInactive}
      aria-disabled={isInactive || undefined}
      className={cx(
        shape === 'cell' ? CELL_BASE : PILL_BASE,
        TRANSITION_CLASSES[transition],
        FOCUS_RING,
        stateClasses,
        className
      )}
    >
      {children}
    </button>
  );
});
