import { buildDatePickerGrid } from './date-picker-view';

/**
 * Unlike `../bulk-modal/bulk-view.spec.ts`'s `buildMonthGrid`, this suite does not
 * check for a past day or a Czech public holiday being blocked — this picker
 * only navigates the lot screen, it never books, so a past day and a holiday
 * stay pickable. A weekend day is the one exception: `../lot-screen/lot-screen.tsx`'s
 * day-navigation arrows already skip weekends (`nextWeekday`/`previousWeekday`),
 * and this picker enforces the same rule when a day is chosen directly. What is
 * otherwise worth asserting is the layout `../calendar-grid.ts` gives it
 * (Monday-first, padded to whole weeks) and the one other fact this module
 * adds: which cell, if any, is the day currently open.
 */

function cells(grid: ReturnType<typeof buildDatePickerGrid>) {
  return grid.weeks
    .flatMap((week) => week.slots.map((slot) => slot.day))
    .filter((day) => day !== null);
}

describe('buildDatePickerGrid — the layout', () => {
  it('lays September 2026 out Monday-first, with the 1st (a Tuesday) one slot in', () => {
    const grid = buildDatePickerGrid('2026-09-15', '2026-09-15');
    const firstWeek = grid.weeks[0];
    expect(firstWeek?.slots[0]?.day).toBeNull();
    expect(firstWeek?.slots[1]?.day?.date).toBe('2026-09-01');
  });

  it('produces exactly the days in the month, none blocked', () => {
    const grid = buildDatePickerGrid('2026-09-15', '2026-09-15');
    expect(cells(grid)).toHaveLength(30);
  });
});

describe('buildDatePickerGrid — which days may be picked', () => {
  it('still marks a past day as selectable — this picker only navigates, it never books', () => {
    const grid = buildDatePickerGrid('2026-01-15', '2026-06-01');
    const day = cells(grid).find((day) => day?.date === '2026-01-05');
    expect(day?.selectable).toBe(true);
  });

  it('marks a weekend day as not selectable', () => {
    // 2026-09-05 is a Saturday.
    const grid = buildDatePickerGrid('2026-09-15', '2026-09-15');
    const day = cells(grid).find((day) => day?.date === '2026-09-05');
    expect(day?.selectable).toBe(false);
  });

  it('marks an ordinary weekday as selectable', () => {
    // 2026-09-01 is a Tuesday.
    const grid = buildDatePickerGrid('2026-09-15', '2026-09-15');
    const day = cells(grid).find((day) => day?.date === '2026-09-01');
    expect(day?.selectable).toBe(true);
  });
});

describe('buildDatePickerGrid — which cell is selected', () => {
  it('marks the day matching selectedDate, and only that one', () => {
    const grid = buildDatePickerGrid('2026-09-15', '2026-09-15');
    const selected = cells(grid).filter((day) => day?.selected === true);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.date).toBe('2026-09-15');
  });

  it('marks no cell when selectedDate falls outside the browsed month', () => {
    const grid = buildDatePickerGrid('2026-09-15', '2026-10-05');
    expect(cells(grid).every((day) => day?.selected === false)).toBe(true);
  });
});
