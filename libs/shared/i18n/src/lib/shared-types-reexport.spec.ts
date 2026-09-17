/**
 * Proves the `doc/decision/0003-*` re-export actually works — feature code
 * imports `@garage/i18n` alone and gets the Europe/Prague date logic and
 * Czech holidays, without reaching into `@garage/shared-types` itself.
 *
 * This does not re-derive the holiday rules (Easter, weekends, …) — those
 * have their own 148 tests in `libs/garage/shared-types`. It only checks that the
 * values reaching feature code through this lib's barrel are the same ones.
 */
import { czechPublicHolidayOn, isBusinessDay, isCzechPublicHoliday, isWeekend } from '../index';

describe('re-exported weekends', () => {
  it('flags Saturday and Sunday', () => {
    expect(isWeekend('2026-09-26')).toBe(true); // Saturday
    expect(isWeekend('2026-09-27')).toBe(true); // Sunday
    expect(isWeekend('2026-09-28')).toBe(false); // Monday
  });
});

describe('re-exported Czech holidays', () => {
  it('recognizes a fixed-date holiday', () => {
    expect(isCzechPublicHoliday('2026-09-28')).toBe(true); // Den české státnosti
    expect(czechPublicHolidayOn('2026-09-28')?.id).toBe('CZECH_STATEHOOD');
  });

  it('recognizes the movable Easter Monday', () => {
    // Easter Sunday 2026 is 5 April, so Easter Monday is 6 April.
    expect(isCzechPublicHoliday('2026-04-06')).toBe(true);
    expect(czechPublicHolidayOn('2026-04-06')?.id).toBe('EASTER_MONDAY');
  });

  it('leaves an ordinary business day alone', () => {
    expect(isCzechPublicHoliday('2026-09-29')).toBe(false);
    expect(isBusinessDay('2026-09-29')).toBe(true);
  });
});
