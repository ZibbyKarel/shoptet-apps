/**
 * The week-grid arithmetic behind every month calendar in `lot/`: lay a
 * month out as seven-wide, Monday-first rows, with `null` slots for the days
 * before the 1st and after the last that belong to a neighbouring month.
 *
 * Extracted from `./bulk-modal/bulk-view.ts`'s `buildMonthGrid` when `./date-picker-dialog/date-picker-view.ts`
 * needed the identical layout for a different cell shape — the bulk grid's
 * cells carry a `selectable`/`block` reason, the date picker's carry only
 * whether the day is the one currently open. Both callers own their own cell
 * type and their own rule for what a day *means*; this module only owns where
 * it sits.
 */

import {
  addDays,
  dayOfWeek,
  endOfMonth,
  parseDateOnly,
  startOfMonth,
  toYearMonth,
} from '@garage/i18n';
import type { DateOnly, YearMonth } from '@garage/i18n';

const DAYS_PER_WEEK = 7;

export interface CalendarSlot<TCell> {
  readonly key: string;
  readonly day: TCell | null;
}

export interface CalendarWeek<TCell> {
  readonly key: string;
  readonly slots: readonly CalendarSlot<TCell>[];
}

export interface CalendarGrid<TCell> {
  readonly month: YearMonth;
  readonly weeks: readonly CalendarWeek<TCell>[];
}

/**
 * The month containing `anchor`, laid out as every design in `lot/` draws it.
 * `toCell` decides what each in-month day becomes; this function only decides
 * which days those are and how they pad out to whole weeks.
 */
export function buildCalendarGrid<TCell>(
  anchor: DateOnly,
  toCell: (date: DateOnly) => TCell
): CalendarGrid<TCell> {
  const month = toYearMonth(anchor);
  const first = startOfMonth(anchor);
  const dayCount = parseDateOnly(endOfMonth(anchor)).day;
  const leadingBlanks = dayOfWeek(first) - 1;

  const slots: CalendarSlot<TCell>[] = Array.from({ length: leadingBlanks }, (_unused, index) => ({
    key: `${month}-lead-${String(index)}`,
    day: null,
  }));
  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = addDays(first, offset);
    slots.push({ key: date, day: toCell(date) });
  }
  while (slots.length % DAYS_PER_WEEK !== 0) {
    slots.push({ key: `${month}-trail-${String(slots.length)}`, day: null });
  }

  const weeks: CalendarWeek<TCell>[] = [];
  for (let start = 0; start < slots.length; start += DAYS_PER_WEEK) {
    weeks.push({
      key: `${month}-w${String(start / DAYS_PER_WEEK)}`,
      slots: slots.slice(start, start + DAYS_PER_WEEK),
    });
  }

  return { month, weeks };
}
