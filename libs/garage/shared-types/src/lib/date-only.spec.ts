import {
  addDays,
  addMonths,
  assertDateOnly,
  compareDateOnly,
  dayOfWeek,
  daysInMonth,
  differenceInDays,
  endOfMonth,
  formatDateOnly,
  fromUtcMidnight,
  isAfter,
  isBefore,
  isDateOnly,
  isSameDay,
  isWeekend,
  isYearMonth,
  nextWeekday,
  parseDateOnly,
  previousWeekday,
  startOfMonth,
  startOfYearMonth,
  toUtcMidnight,
  toYearMonth,
} from './date-only';

describe('isDateOnly', () => {
  it.each(['2026-08-28', '2024-02-29', '1970-01-01', '2000-12-31'])('accepts %s', (value) => {
    expect(isDateOnly(value)).toBe(true);
  });

  it.each([
    '2023-02-29', // not a leap year
    '2026-04-31', // April has 30 days
    '2026-13-01', // no 13th month
    '2026-00-10', // no zeroth month
    '2026-08-00', // no zeroth day
    '2026-8-28', // not zero-padded
    '20260828', // no separators
    '2026-08-28T00:00:00Z', // a timestamp, not a date
    '',
  ])('rejects %s', (value) => {
    expect(isDateOnly(value)).toBe(false);
  });

  it.each([undefined, null, 42, new Date(), {}])('rejects the non-string %p', (value) => {
    expect(isDateOnly(value)).toBe(false);
  });
});

describe('isYearMonth', () => {
  it('accepts a padded year-month', () => {
    expect(isYearMonth('2026-01')).toBe(true);
  });

  it.each(['2026-13', '2026-00', '2026-1', '2026', '2026-01-01', 7])('rejects %p', (value) => {
    expect(isYearMonth(value)).toBe(false);
  });
});

describe('assertDateOnly / parseDateOnly', () => {
  it('splits a valid date into parts', () => {
    expect(parseDateOnly('2026-08-28')).toEqual({ year: 2026, month: 8, day: 28 });
  });

  it('throws on an invalid date', () => {
    expect(() => assertDateOnly('2023-02-29')).toThrow(TypeError);
    expect(() => parseDateOnly('nope')).toThrow(/YYYY-MM-DD/);
  });
});

describe('formatDateOnly', () => {
  it('zero-pads month and day', () => {
    expect(formatDateOnly({ year: 2026, month: 1, day: 2 })).toBe('2026-01-02');
  });

  it('normalizes an overflowing month into the next year', () => {
    expect(formatDateOnly({ year: 2026, month: 13, day: 1 })).toBe('2027-01-01');
  });

  it('normalizes day 0 to the last day of the previous month, in the right year', () => {
    // 2026 is not a leap year; a Date.UTC-based implementation anchored on a
    // leap year would wrongly return 2026-02-29 here.
    expect(formatDateOnly({ year: 2026, month: 3, day: 0 })).toBe('2026-02-28');
    expect(formatDateOnly({ year: 2024, month: 3, day: 0 })).toBe('2024-02-29');
  });
});

describe('toUtcMidnight / fromUtcMidnight', () => {
  it('maps a calendar day onto UTC midnight', () => {
    expect(toUtcMidnight('2026-08-28').toISOString()).toBe('2026-08-28T00:00:00.000Z');
  });

  it('reads a UTC-midnight Date back as the same calendar day', () => {
    expect(fromUtcMidnight(new Date('2026-08-28T00:00:00.000Z'))).toBe('2026-08-28');
  });

  it('round-trips every day across a Europe/Prague DST transition', () => {
    // The host may be running in any zone; UTC has no transitions, so these
    // hold everywhere. 2026-03-29 is the spring-forward Sunday.
    for (const day of ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-25']) {
      expect(fromUtcMidnight(toUtcMidnight(day))).toBe(day);
    }
  });

  it('keeps a year below 100 as itself, not as a 1900s year', () => {
    // `Date.UTC(26, 0, 1)` would be 1926. `utcMidnight`'s `setUTCFullYear` is
    // why this module does not use it — see the note on `utcMidnight`.
    expect(toUtcMidnight('0026-01-01').getUTCFullYear()).toBe(26);
    expect(fromUtcMidnight(toUtcMidnight('0026-01-01'))).toBe('0026-01-01');
  });

  it('rejects a value that is not a real calendar day', () => {
    expect(() => toUtcMidnight('2026-02-30')).toThrow(TypeError);
  });

  it('truncates a Date that is not midnight to its UTC calendar day', () => {
    expect(fromUtcMidnight(new Date('2026-08-28T23:59:59.999Z'))).toBe('2026-08-28');
  });
});

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2024, 2, 29],
    [2000, 2, 29], // divisible by 400 -> leap
    [1900, 2, 28], // divisible by 100 but not 400 -> not leap
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i has %i days', (year, month, expected) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });
});

describe('addDays', () => {
  it('moves within a month', () => {
    expect(addDays('2026-08-28', 3)).toBe('2026-08-31');
    expect(addDays('2026-08-28', -3)).toBe('2026-08-25');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles February in leap and non-leap years', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  describe('across a daylight saving transition in Europe/Prague', () => {
    // 2026-03-29 is 23 hours long (CET -> CEST) and 2026-10-25 is 25 hours
    // long (CEST -> CET). Any implementation that adds 86_400_000 ms to a
    // local timestamp skips or repeats a day on exactly these two dates.
    it('adds one day across the spring-forward day', () => {
      expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
      expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
      expect(addDays('2026-03-30', -1)).toBe('2026-03-29');
    });

    it('adds one day across the autumn fall-back day', () => {
      expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
      expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
      expect(addDays('2026-10-26', -1)).toBe('2026-10-25');
    });

    it('counts a whole March correctly despite the lost hour', () => {
      expect(addDays('2026-03-01', 30)).toBe('2026-03-31');
      expect(differenceInDays('2026-03-31', '2026-03-01')).toBe(30);
      expect(differenceInDays('2026-10-31', '2026-10-01')).toBe(30);
    });
  });
});

describe('addMonths', () => {
  it('clamps onto shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('crosses the year boundary in both directions', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15');
  });
});

describe('differenceInDays', () => {
  it('is signed and exact across a year boundary', () => {
    expect(differenceInDays('2027-01-01', '2026-12-31')).toBe(1);
    expect(differenceInDays('2026-12-31', '2027-01-01')).toBe(-1);
    expect(differenceInDays('2026-01-01', '2026-01-01')).toBe(0);
    expect(differenceInDays('2025-01-01', '2024-01-01')).toBe(366); // 2024 is a leap year
  });
});

describe('comparison', () => {
  it('orders dates', () => {
    expect(compareDateOnly('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDateOnly('2026-01-02', '2026-01-01')).toBe(1);
    expect(compareDateOnly('2026-01-01', '2026-01-01')).toBe(0);
    expect(isBefore('2025-12-31', '2026-01-01')).toBe(true);
    expect(isAfter('2026-01-01', '2025-12-31')).toBe(true);
    expect(isSameDay('2026-01-01', '2026-01-01')).toBe(true);
  });

  it('rejects invalid operands instead of comparing garbage', () => {
    expect(() => compareDateOnly('2026-02-30', '2026-01-01')).toThrow(TypeError);
  });
});

describe('month helpers', () => {
  it('finds the first and last day of a month', () => {
    expect(startOfMonth('2026-08-28')).toBe('2026-08-01');
    expect(endOfMonth('2026-08-28')).toBe('2026-08-31');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });

  it('converts between a date and its year-month', () => {
    expect(toYearMonth('2026-08-28')).toBe('2026-08');
    expect(startOfYearMonth('2026-08')).toBe('2026-08-01');
    expect(() => startOfYearMonth('2026-13')).toThrow(TypeError);
  });
});

describe('dayOfWeek / isWeekend', () => {
  it.each([
    ['2026-08-24', 1], // Monday
    ['2026-08-25', 2],
    ['2026-08-26', 3],
    ['2026-08-27', 4],
    ['2026-08-28', 5], // Friday
    ['2026-08-29', 6], // Saturday
    ['2026-08-30', 7], // Sunday
    ['1970-01-01', 4], // epoch day 0 was a Thursday
    ['1969-12-31', 3], // negative epoch day
  ])('%s is ISO weekday %i', (date, expected) => {
    expect(dayOfWeek(date)).toBe(expected);
  });

  it('treats Saturday and Sunday as the weekend', () => {
    expect(isWeekend('2026-08-28')).toBe(false);
    expect(isWeekend('2026-08-29')).toBe(true);
    expect(isWeekend('2026-08-30')).toBe(true);
    expect(isWeekend('2026-08-31')).toBe(false);
  });
});

describe('nextWeekday / previousWeekday', () => {
  it('nextWeekday moves an ordinary weekday by one day', () => {
    // 2026-08-24 is a Monday.
    expect(nextWeekday('2026-08-24')).toBe('2026-08-25');
  });

  it('nextWeekday skips the whole weekend, landing on Monday', () => {
    // 2026-08-28 is a Friday; 2026-08-29/30 are Saturday/Sunday.
    expect(nextWeekday('2026-08-28')).toBe('2026-08-31');
  });

  it('nextWeekday started from a Saturday still lands on the following Monday', () => {
    expect(nextWeekday('2026-08-29')).toBe('2026-08-31');
  });

  it('previousWeekday moves an ordinary weekday back by one day', () => {
    // 2026-08-25 is a Tuesday.
    expect(previousWeekday('2026-08-25')).toBe('2026-08-24');
  });

  it('previousWeekday skips the whole weekend, landing on the prior Friday', () => {
    // 2026-08-31 is a Monday.
    expect(previousWeekday('2026-08-31')).toBe('2026-08-28');
  });

  it('previousWeekday started from a Sunday still lands on the same prior Friday', () => {
    expect(previousWeekday('2026-08-30')).toBe('2026-08-28');
  });
});
