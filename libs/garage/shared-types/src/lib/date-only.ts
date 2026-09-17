/**
 * Date-only (`YYYY-MM-DD`) primitive and pure civil-calendar arithmetic.
 *
 * A reservation day is a *calendar* day, never an instant: `2026-03-29` means
 * the same day for everybody, regardless of the machine's clock or time zone.
 * Everything in this module therefore works on the civil calendar and never
 * touches a time zone. Only `prague-time.ts` maps between instants and calendar
 * days, and it is the single place in the workspace that knows about
 * Europe/Prague.
 *
 * The arithmetic is built on UTC epoch days rather than on local `Date`
 * objects. UTC has no daylight saving, so adding a day is always exactly one
 * calendar day — including on the two DST transition days per year, which are
 * 23 and 25 hours long in Europe/Prague and would break any implementation
 * based on adding 86_400_000 ms to a local timestamp.
 *
 * `DateOnly` is deliberately an unbranded alias of `string` — see
 * `doc/decision/0014-dateonly-is-an-unbranded-string.md`.
 */

/** ISO 8601 calendar date, `YYYY-MM-DD`. */
export type DateOnly = string;

/** Calendar month, `YYYY-MM`. Used by the reservation-window overview. */
export type YearMonth = string;

/** Calendar date split into its parts. `month` is 1-based (1 = January). */
export interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

const MS_PER_DAY = 86_400_000;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}

/**
 * Builds the UTC midnight `Date` for the given calendar parts.
 *
 * `setUTCFullYear(year, monthIndex, day)` is used instead of `Date.UTC(...)`
 * because it normalizes out-of-range months and days against the *actual*
 * year — `Date.UTC` would resolve `day: 0` against the wrong year's February
 * and also remaps two-digit years into the 1900s.
 */
function utcMidnight(parts: DateParts): Date {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/** Number of days in the given 1-based month. */
export function daysInMonth(year: number, month: number): number {
  return utcMidnight({ year, month: month + 1, day: 0 }).getUTCDate();
}

/**
 * True when `value` is a syntactically valid `YYYY-MM-DD` string that also
 * denotes a real calendar day (rejects `2023-02-29`, `2026-04-31`, ...).
 */
export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string') {
    return false;
  }
  const match = DATE_ONLY_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= daysInMonth(year, month);
}

/** True when `value` is a valid `YYYY-MM` string. */
export function isYearMonth(value: unknown): value is YearMonth {
  if (typeof value !== 'string') {
    return false;
  }
  const match = YEAR_MONTH_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** Throws unless `value` is a valid `DateOnly`. Narrows the type on success. */
export function assertDateOnly(value: unknown): asserts value is DateOnly {
  if (!isDateOnly(value)) {
    throw new TypeError(`Not a valid YYYY-MM-DD date: ${JSON.stringify(value)}`);
  }
}

/** Splits a `DateOnly` into its numeric parts. Throws on invalid input. */
export function parseDateOnly(value: DateOnly): DateParts {
  assertDateOnly(value);
  const match = DATE_ONLY_PATTERN.exec(value) as RegExpExecArray;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/**
 * Serializes calendar parts into `YYYY-MM-DD`.
 *
 * Out-of-range parts are normalized (`{ year: 2026, month: 13, day: 1 }` →
 * `2027-01-01`, `{ year: 2026, month: 3, day: 0 }` → `2026-02-28`), which is
 * what makes `addDays` and `addMonths` below trivially correct.
 */
export function formatDateOnly(parts: DateParts): DateOnly {
  const date = utcMidnight(parts);
  return `${pad4(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * The UTC-midnight `Date` standing in for a calendar day.
 *
 * A `DateOnly` is a calendar day, not an instant, but every path that formats
 * one for a human or writes one into a `@db.Date` column has to hand a `Date`
 * to something. UTC midnight is the stand-in this workspace uses everywhere,
 * always read back or rendered with an explicit UTC, because that is what
 * guarantees the day that comes out is the day asked for on every host, in
 * every offset, on both sides of a daylight-saving change.
 *
 * Unlike the module-private `utcMidnight` this takes a `DateOnly`, so
 * `parseDateOnly` has already rejected anything that is not a real calendar
 * day — a caller cannot silently have out-of-range parts normalized into a
 * different day here.
 */
export function toUtcMidnight(value: DateOnly): Date {
  return utcMidnight(parseDateOnly(value));
}

/**
 * The calendar day a UTC-midnight `Date` stands for. Inverse of
 * {@link toUtcMidnight}.
 *
 * The parts are read with UTC getters, never local ones: local getters would
 * move the day by one for any process running west of Greenwich.
 */
export function fromUtcMidnight(value: Date): DateOnly {
  return formatDateOnly({
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  });
}

/** Days since 1970-01-01, computed in UTC so it is exact and DST-immune. */
function epochDay(value: DateOnly): number {
  return Math.round(utcMidnight(parseDateOnly(value)).getTime() / MS_PER_DAY);
}

/** Shifts a calendar date by whole days. DST-immune by construction. */
export function addDays(value: DateOnly, days: number): DateOnly {
  const { year, month, day } = parseDateOnly(value);
  return formatDateOnly({ year, month, day: day + days });
}

/** Shifts a calendar date by whole months, clamping to the shorter month. */
export function addMonths(value: DateOnly, months: number): DateOnly {
  const { year, month, day } = parseDateOnly(value);
  const monthIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = monthIndex - targetYear * 12 + 1;
  return formatDateOnly({
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, daysInMonth(targetYear, targetMonth)),
  });
}

/** Whole calendar days between two dates (`a - b`). */
export function differenceInDays(a: DateOnly, b: DateOnly): number {
  return epochDay(a) - epochDay(b);
}

/** `-1` when `a` is earlier, `0` when equal, `1` when `a` is later. */
export function compareDateOnly(a: DateOnly, b: DateOnly): -1 | 0 | 1 {
  assertDateOnly(a);
  assertDateOnly(b);
  // Zero-padded ISO dates sort lexicographically in calendar order.
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBefore(a: DateOnly, b: DateOnly): boolean {
  return compareDateOnly(a, b) < 0;
}

export function isAfter(a: DateOnly, b: DateOnly): boolean {
  return compareDateOnly(a, b) > 0;
}

export function isSameDay(a: DateOnly, b: DateOnly): boolean {
  return compareDateOnly(a, b) === 0;
}

/** First day of the month containing `value`. */
export function startOfMonth(value: DateOnly): DateOnly {
  const { year, month } = parseDateOnly(value);
  return formatDateOnly({ year, month, day: 1 });
}

/** Last day of the month containing `value`. */
export function endOfMonth(value: DateOnly): DateOnly {
  const { year, month } = parseDateOnly(value);
  return formatDateOnly({ year, month, day: daysInMonth(year, month) });
}

/** `YYYY-MM` of the month containing `value`. */
export function toYearMonth(value: DateOnly): YearMonth {
  const { year, month } = parseDateOnly(value);
  return `${pad4(year)}-${pad2(month)}`;
}

/** First day of a `YYYY-MM` month. Throws on invalid input. */
export function startOfYearMonth(value: YearMonth): DateOnly {
  if (!isYearMonth(value)) {
    throw new TypeError(`Not a valid YYYY-MM month: ${JSON.stringify(value)}`);
  }
  const match = YEAR_MONTH_PATTERN.exec(value) as RegExpExecArray;
  return formatDateOnly({ year: Number(match[1]), month: Number(match[2]), day: 1 });
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function dayOfWeek(value: DateOnly): number {
  // 1970-01-01 (epoch day 0) was a Thursday, i.e. ISO weekday 4.
  return ((((epochDay(value) + 3) % 7) + 7) % 7) + 1;
}

/** Saturday or Sunday. */
export function isWeekend(value: DateOnly): boolean {
  return dayOfWeek(value) >= 6;
}

/** The next calendar day after `value`, skipping Saturday and Sunday. */
export function nextWeekday(value: DateOnly): DateOnly {
  let candidate = addDays(value, 1);
  while (isWeekend(candidate)) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

/** The calendar day before `value`, skipping Saturday and Sunday. */
export function previousWeekday(value: DateOnly): DateOnly {
  let candidate = addDays(value, -1);
  while (isWeekend(candidate)) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
}
