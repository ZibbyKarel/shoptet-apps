import {
  CZECH_HOLIDAY_IDS,
  czechPublicHolidayOn,
  czechPublicHolidays,
  easterMonday,
  easterSunday,
  goodFriday,
  isBusinessDay,
  isCzechPublicHoliday,
} from './czech-holidays';
import type { CzechHoliday } from './czech-holidays';
import { dayOfWeek } from './date-only';

/**
 * Independently published Western (Gregorian) Easter Sunday dates. The range
 * deliberately spans leap years (2024, 2028), the earliest and latest possible
 * Easter dates in the near term (2008 in March, 2038 in late April) and a run
 * of consecutive years.
 */
const KNOWN_EASTER_SUNDAYS: readonly [number, string][] = [
  [2008, '2008-03-23'],
  [2020, '2020-04-12'],
  [2021, '2021-04-04'],
  [2022, '2022-04-17'],
  [2023, '2023-04-09'],
  [2024, '2024-03-31'],
  [2025, '2025-04-20'],
  [2026, '2026-04-05'],
  [2027, '2027-03-28'],
  [2028, '2028-04-16'],
  [2029, '2029-04-01'],
  [2030, '2030-04-21'],
  [2038, '2038-04-25'],
];

describe('easterSunday', () => {
  it.each(KNOWN_EASTER_SUNDAYS)('resolves %i to %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });

  it('always lands on a Sunday', () => {
    for (let year = 2020; year <= 2050; year += 1) {
      expect(dayOfWeek(easterSunday(year))).toBe(7);
    }
  });
});

describe('goodFriday / easterMonday', () => {
  it.each(KNOWN_EASTER_SUNDAYS)('brackets Easter %i correctly', (year) => {
    expect(dayOfWeek(goodFriday(year))).toBe(5);
    expect(dayOfWeek(easterMonday(year))).toBe(1);
  });

  it.each([
    [2024, '2024-03-29', '2024-04-01'], // leap year, Easter in March
    [2025, '2025-04-18', '2025-04-21'],
    [2026, '2026-04-03', '2026-04-06'], // matches the approved design
    [2027, '2027-03-26', '2027-03-29'],
    [2028, '2028-04-14', '2028-04-17'], // leap year
  ])('places %i on %s and %s', (year, friday, monday) => {
    expect(goodFriday(year)).toBe(friday);
    expect(easterMonday(year)).toBe(monday);
  });
});

describe('czechPublicHolidays', () => {
  it('returns all thirteen holidays, sorted, with unique ids', () => {
    const holidays = czechPublicHolidays(2026);
    expect(holidays).toHaveLength(CZECH_HOLIDAY_IDS.length);
    expect(holidays.map((holiday) => holiday.id).sort()).toEqual([...CZECH_HOLIDAY_IDS].sort());
    expect(holidays.map((holiday) => holiday.date)).toEqual(
      [...holidays.map((holiday) => holiday.date)].sort()
    );
  });

  it('places every fixed holiday on its statutory date', () => {
    const dates = new Map(czechPublicHolidays(2026).map((holiday) => [holiday.id, holiday.date]));
    expect(dates.get('NEW_YEAR')).toBe('2026-01-01');
    expect(dates.get('LABOUR_DAY')).toBe('2026-05-01');
    expect(dates.get('VICTORY_DAY')).toBe('2026-05-08');
    expect(dates.get('CYRIL_AND_METHODIUS')).toBe('2026-07-05');
    expect(dates.get('JAN_HUS')).toBe('2026-07-06');
    expect(dates.get('CZECH_STATEHOOD')).toBe('2026-09-28');
    expect(dates.get('INDEPENDENT_CZECHOSLOVAK_STATE')).toBe('2026-10-28');
    expect(dates.get('STRUGGLE_FOR_FREEDOM_AND_DEMOCRACY')).toBe('2026-11-17');
    expect(dates.get('CHRISTMAS_EVE')).toBe('2026-12-24');
    expect(dates.get('CHRISTMAS_DAY')).toBe('2026-12-25');
    expect(dates.get('SECOND_CHRISTMAS_DAY')).toBe('2026-12-26');
  });

  it('keeps the fixed dates in a leap year', () => {
    const dates = czechPublicHolidays(2024).map((holiday) => holiday.date);
    expect(dates).toContain('2024-05-08');
    expect(dates).toContain('2024-12-24');
  });

  it('omits Good Friday before it became a public holiday in 2016', () => {
    // Novela z. 245/2000 Sb. added Good Friday from 2016. The pure function had
    // no lower bound, so czechPublicHolidays(2015) claimed a holiday that did
    // not exist (Task 3 review, N1).
    const ids2015 = czechPublicHolidays(2015).map((holiday) => holiday.id);
    expect(ids2015).not.toContain('GOOD_FRIDAY');
    expect(ids2015).toContain('EASTER_MONDAY');
    expect(ids2015).toHaveLength(CZECH_HOLIDAY_IDS.length - 1);

    expect(czechPublicHolidays(2016).map((holiday) => holiday.id)).toContain('GOOD_FRIDAY');
  });

  it('names the movable holidays in Czech', () => {
    const holidays = czechPublicHolidays(2026);
    expect(holidays.find((holiday) => holiday.id === 'GOOD_FRIDAY')?.name).toBe('Velký pátek');
    expect(holidays.find((holiday) => holiday.id === 'EASTER_MONDAY')?.name).toBe(
      'Velikonoční pondělí'
    );
  });

  it('does not make Easter Sunday itself a holiday', () => {
    expect(isCzechPublicHoliday(easterSunday(2026))).toBe(false);
  });

  it('covers every declared holiday id and no others, in every year', () => {
    for (const year of [2016, 2024, 2026, 2030]) {
      const ids = czechPublicHolidays(year).map((holiday) => holiday.id);
      expect([...ids].sort()).toEqual([...CZECH_HOLIDAY_IDS].sort());
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('czechPublicHolidayOn / isCzechPublicHoliday', () => {
  it('finds a fixed holiday', () => {
    expect(czechPublicHolidayOn('2026-09-28')).toEqual({
      id: 'CZECH_STATEHOOD',
      date: '2026-09-28',
      name: 'Den české státnosti',
    });
  });

  it('finds a movable holiday', () => {
    expect(czechPublicHolidayOn('2026-04-06')?.id).toBe('EASTER_MONDAY');
  });

  it('returns null on an ordinary day', () => {
    expect(czechPublicHolidayOn('2026-08-28')).toBeNull();
    expect(isCzechPublicHoliday('2026-08-28')).toBe(false);
  });

  it('rejects an invalid date', () => {
    expect(() => isCzechPublicHoliday('2026-02-30')).toThrow(TypeError);
  });
});

describe('isBusinessDay', () => {
  it('excludes weekends', () => {
    expect(isBusinessDay('2026-08-28')).toBe(true); // Friday
    expect(isBusinessDay('2026-08-29')).toBe(false); // Saturday
    expect(isBusinessDay('2026-08-30')).toBe(false); // Sunday
  });

  it('excludes holidays that fall on a weekday', () => {
    expect(dayOfWeek('2026-09-28')).toBe(1); // Monday
    expect(isBusinessDay('2026-09-28')).toBe(false);
    expect(isBusinessDay('2026-04-03')).toBe(false); // Good Friday
  });
});

describe('czechPublicHolidays caching', () => {
  it('returns equal values for a repeated year', () => {
    expect(czechPublicHolidays(2026)).toEqual(czechPublicHolidays(2026));
    expect(czechPublicHolidays(2026)).toHaveLength(CZECH_HOLIDAY_IDS.length);
  });

  it('keeps distinct years distinct', () => {
    expect(czechPublicHolidays(2026)[0]?.date.startsWith('2026-')).toBe(true);
    expect(czechPublicHolidays(2027)[0]?.date.startsWith('2027-')).toBe(true);
  });

  it('hands out a list one caller cannot corrupt for the next', () => {
    // The list is shared between callers, so a mutation that got through would
    // not stay local — it would rewrite what every later caller reads. Both
    // the array's shape and each entry's fields have to be sealed. How the
    // seal reports a rejected write (throw, or silent no-op) is not the
    // behaviour under test; that the next caller sees the original is.
    const snapshot = czechPublicHolidays(2030).map((holiday) => ({ ...holiday }));
    const holidays = czechPublicHolidays(2030);

    try {
      (holidays as CzechHoliday[]).push({ ...snapshot[0] } as CzechHoliday);
    } catch {
      // A sealed array rejects the push; either way the assertion below decides.
    }
    try {
      (holidays[0] as { name: string }).name = 'mutated';
    } catch {
      // As above.
    }

    expect(czechPublicHolidays(2030)).toEqual(snapshot);
    expect(czechPublicHolidays(2030)).toHaveLength(CZECH_HOLIDAY_IDS.length);
  });

  it('still validates the date before consulting the cache', () => {
    // parseDateOnly is the validator; a memo lookup must not front-run it.
    expect(() => czechPublicHolidayOn('2026-02-30')).toThrow(TypeError);
    expect(() => czechPublicHolidayOn('not-a-date')).toThrow(TypeError);
  });
});
