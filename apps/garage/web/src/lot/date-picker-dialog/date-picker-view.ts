/**
 * The pure half of {@link DatePickerDialog} — Claude Design's `Lets Park.dc.html`
 * (`datePickerOpen` branch), which browses a month grid to jump the lot
 * screen to any day.
 *
 * Unlike `../bulk-modal/bulk-view.ts`'s grid, this picker only navigates, it
 * never books, so a past day or a Czech holiday is as pickable as any other.
 * The one exception is a weekend day: it mirrors the header's own
 * day-navigation arrows in excluding weekends (`nextWeekday`/`previousWeekday`
 * in `libs/garage/shared-types`), enforced here via `selectable: !isWeekend(date)`.
 * `../calendar-grid.ts` supplies the week layout both grids share; this
 * module supplies the one fact its cells carry — is this the day currently
 * open on the lot screen.
 */

import { compareDateOnly, isWeekend, parseDateOnly, type DateOnly } from '@garage/i18n';
import { buildCalendarGrid, type CalendarGrid } from '../calendar-grid';

export interface DatePickerDayCell {
  readonly date: DateOnly;
  readonly dayOfMonth: number;
  readonly selected: boolean;
  readonly selectable: boolean;
}

export type DatePickerGrid = CalendarGrid<DatePickerDayCell>;

/** The month containing `anchor`, with `selectedDate` marked if it falls in it. */
export function buildDatePickerGrid(anchor: DateOnly, selectedDate: DateOnly): DatePickerGrid {
  return buildCalendarGrid(anchor, (date) => ({
    date,
    dayOfMonth: parseDateOnly(date).day,
    selected: compareDateOnly(date, selectedDate) === 0,
    selectable: !isWeekend(date),
  }));
}
