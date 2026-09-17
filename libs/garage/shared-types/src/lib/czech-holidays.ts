/**
 * Czech public holidays ("státní svátky" and "ostatní svátky" as defined by
 * zákon č. 245/2000 Sb.), as a pure function of the year.
 *
 * Eleven of the thirteen are fixed calendar dates. The remaining two — Good
 * Friday and Easter Monday — move with Easter, so they are derived from a real
 * Easter algorithm (Meeus/Jones/Butcher for the Gregorian calendar) rather
 * than from a hard-coded table that would silently expire.
 *
 * The Czech names are domain data shown in the UI, so they stay Czech (see
 * `CLAUDE.md` on UI copy); the stable `id` is what feature code and
 * `libs/shared/i18n` key on. Localizing the labels is deliberately not this
 * module's job — see `doc/decision/0300-*`.
 */

import { addDays, formatDateOnly, isWeekend, parseDateOnly, type DateOnly } from './date-only';

export const CZECH_HOLIDAY_IDS = [
  'NEW_YEAR',
  'GOOD_FRIDAY',
  'EASTER_MONDAY',
  'LABOUR_DAY',
  'VICTORY_DAY',
  'CYRIL_AND_METHODIUS',
  'JAN_HUS',
  'CZECH_STATEHOOD',
  'INDEPENDENT_CZECHOSLOVAK_STATE',
  'STRUGGLE_FOR_FREEDOM_AND_DEMOCRACY',
  'CHRISTMAS_EVE',
  'CHRISTMAS_DAY',
  'SECOND_CHRISTMAS_DAY',
] as const;

export type CzechHolidayId = (typeof CZECH_HOLIDAY_IDS)[number];

export interface CzechHoliday {
  /**
   * Stable, language-independent identity. This is what callers, tests and
   * message catalogs key on; it never changes once published.
   */
  readonly id: CzechHolidayId;
  readonly date: DateOnly;
  /**
   * The official Czech name, as published in act 245/2000 Sb.
   *
   * It is a **default label**, not the translation layer: this module is the
   * calendar, not the place that answers "what is this day called in the
   * user's language". When the app grows a second locale, the localized
   * string comes from the message catalog keyed on {@link id}, and `name`
   * stays as the Czech fallback the law actually uses.
   */
  readonly name: string;
}

/**
 * A holiday whose date is a fixed calendar day, independent of the year.
 *
 * The fields are named rather than positional on purpose: 5 July and 6 July
 * are two different holidays one transposition apart, and in a tuple table
 * nothing but the reader's care distinguished `[7, 5, …]` from `[7, 6, …]`.
 */
interface FixedHoliday {
  /** 1-based month, as `formatDateOnly` expects. */
  readonly month: number;
  readonly day: number;
  readonly id: CzechHolidayId;
  /** Official Czech name, as displayed in the UI. */
  readonly name: string;
}

const FIXED_HOLIDAYS: readonly FixedHoliday[] = [
  { month: 1, day: 1, id: 'NEW_YEAR', name: 'Nový rok' },
  { month: 5, day: 1, id: 'LABOUR_DAY', name: 'Svátek práce' },
  { month: 5, day: 8, id: 'VICTORY_DAY', name: 'Den vítězství' },
  {
    month: 7,
    day: 5,
    id: 'CYRIL_AND_METHODIUS',
    name: 'Den slovanských věrozvěstů Cyrila a Metoděje',
  },
  { month: 7, day: 6, id: 'JAN_HUS', name: 'Den upálení mistra Jana Husa' },
  { month: 9, day: 28, id: 'CZECH_STATEHOOD', name: 'Den české státnosti' },
  {
    month: 10,
    day: 28,
    id: 'INDEPENDENT_CZECHOSLOVAK_STATE',
    name: 'Den vzniku samostatného československého státu',
  },
  {
    month: 11,
    day: 17,
    id: 'STRUGGLE_FOR_FREEDOM_AND_DEMOCRACY',
    name: 'Den boje za svobodu a demokracii',
  },
  { month: 12, day: 24, id: 'CHRISTMAS_EVE', name: 'Štědrý den' },
  { month: 12, day: 25, id: 'CHRISTMAS_DAY', name: '1. svátek vánoční' },
  { month: 12, day: 26, id: 'SECOND_CHRISTMAS_DAY', name: '2. svátek vánoční' },
];

/**
 * Easter Sunday of the given Gregorian year (Meeus/Jones/Butcher algorithm).
 *
 * The algorithm is integer arithmetic only; the intermediate names follow the
 * published formulation so it can be checked against the source.
 */
export function easterSunday(year: number): DateOnly {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatDateOnly({ year, month, day });
}

/**
 * Good Friday — the Friday before Easter Sunday.
 *
 * This is the *calendar* date and is defined for every year. Whether it is a
 * public holiday is a separate question — see {@link GOOD_FRIDAY_FIRST_YEAR}.
 */
export function goodFriday(year: number): DateOnly {
  return addDays(easterSunday(year), -2);
}

/**
 * First year in which Good Friday was a Czech public holiday.
 *
 * It was added by the 2016 amendment of act 245/2000 Sb.; every other holiday in
 * {@link FIXED_HOLIDAYS} predates the app. A reservation app never looks
 * backwards, so this bound is documentation more than behaviour — but a pure
 * function of the year should not claim something the law did not say.
 */
export const GOOD_FRIDAY_FIRST_YEAR = 2016;

/** Easter Monday — the Monday after Easter Sunday. */
export function easterMonday(year: number): DateOnly {
  return addDays(easterSunday(year), 1);
}

/**
 * Every year's holiday list, computed once.
 *
 * The list is a pure function of the year, so there is nothing to invalidate:
 * this is walked once per day in a range, not once per request, by
 * `buildMonthGrid` in `apps/garage/web/src/lot/bulk-modal/bulk-view.ts` (28–31 days
 * per month), by `planDay` in `apps/garage/api/src/reservations/bulk-allocator.ts`
 * (once per date in a bulk request), and by `isReservableDay` in
 * `apps/garage/api/src/overview/day-overview.service.ts`. Without this, walking a
 * month's worth of days re-ran the Easter algorithm and re-sorted the same
 * thirteen entries thirty-odd times — server-side as well as in the browser.
 */
const holidaysByYear = new Map<number, readonly CzechHoliday[]>();

/**
 * All Czech public holidays of the given year, ordered by date.
 *
 * Note that Easter Sunday itself is *not* a public holiday in Czechia; only
 * Good Friday and Easter Monday are — and Good Friday only from
 * {@link GOOD_FRIDAY_FIRST_YEAR} onwards, so years before that return one
 * holiday fewer.
 *
 * The returned array is shared between callers — it is the cache entry, not a
 * copy — so it is frozen, and so is every entry in it. `Object.freeze` is
 * shallow: freezing only the array would still let a caller write
 * `holidays[0].name` and rewrite what every later caller reads, which is
 * strictly worse than the pre-cache behaviour of corrupting a private copy.
 */
export function czechPublicHolidays(year: number): readonly CzechHoliday[] {
  const cached = holidaysByYear.get(year);
  if (cached !== undefined) {
    return cached;
  }

  const holidays: CzechHoliday[] = [
    ...(year >= GOOD_FRIDAY_FIRST_YEAR
      ? [{ id: 'GOOD_FRIDAY' as const, date: goodFriday(year), name: 'Velký pátek' }]
      : []),
    { id: 'EASTER_MONDAY', date: easterMonday(year), name: 'Velikonoční pondělí' },
    ...FIXED_HOLIDAYS.map(({ month, day, id, name }) => ({
      id,
      date: formatDateOnly({ year, month, day }),
      name,
    })),
  ];
  holidays.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));

  const frozen = Object.freeze(holidays.map((holiday) => Object.freeze(holiday)));
  holidaysByYear.set(year, frozen);
  return frozen;
}

/** The holiday falling on `date`, or `null` when it is an ordinary day. */
export function czechPublicHolidayOn(date: DateOnly): CzechHoliday | null {
  const { year } = parseDateOnly(date);
  return czechPublicHolidays(year).find((holiday) => holiday.date === date) ?? null;
}

/** True when `date` is a Czech public holiday. */
export function isCzechPublicHoliday(date: DateOnly): boolean {
  return czechPublicHolidayOn(date) !== null;
}

/**
 * True when `date` is a working day: not a weekend and not a public holiday.
 * Bulk booking may only select working days (see `doc/decision/0004-*`).
 */
export function isBusinessDay(date: DateOnly): boolean {
  return !isWeekend(date) && !isCzechPublicHoliday(date);
}
