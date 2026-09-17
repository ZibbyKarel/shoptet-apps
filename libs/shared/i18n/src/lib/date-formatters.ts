/**
 * Date formatting for one locale, built once and reused.
 *
 * The Czech behaviour is exactly what `./dates.ts` did before this file
 * existed, option object for option object — Czech declines month names, and
 * `Intl`'s `cs-CZ` data produces the genitive (`25. srpna`) only when `day` is
 * part of the same format call and the nominative (`srpen`) only when it is
 * not, so the two option objects stay separate on purpose. See
 * `doc/decision/0024-czech-month-declension-genitive-vs-nominative.md`; do not
 * merge them.
 *
 * Every input is a `DateOnly` (`YYYY-MM-DD`), never an instant, so each
 * function builds a UTC-midnight stand-in and formats with an explicit
 * `timeZone: 'UTC'` — the displayed day is the calendar day the caller asked
 * for, whatever the host zone or a daylight-saving transition would do to it.
 * That `'UTC'` is unrelated to `PRAGUE_TIME_ZONE` on `IntlProvider`.
 */

import { createFormatter, useLocale } from 'next-intl';
import { toUtcMidnight, type DateOnly } from '@garage/shared-types';
import { DEFAULT_LOCALE, isLocale, type Locale } from './locale';
import { MONTH_LOCATIVE_CS } from './dates';

export interface DateFormatters {
  /** `pondělí 28. září 2026` / `Monday, September 28, 2026`. */
  fullDate(date: DateOnly): string;
  /** `28. srpna 2026` / `August 28, 2026` — no weekday. */
  dayMonthAndYear(date: DateOnly): string;
  /** `25. srpna` / `August 25`. */
  dayAndMonth(date: DateOnly): string;
  /** `srpen 2026` / `August 2026`. */
  monthAndYear(date: DateOnly): string;
  /** `září` / `September` — standalone, 1-based month. */
  monthName(month: number): string;
  /** The form that reads after "in": `v září`, `v srpnu` / `in September`. */
  monthLocative(month: number): string;
  /** `pondělí` / `Monday`. */
  weekdayName(date: DateOnly): string;
  /** `2026`. */
  year(year: number): string;
}

function build(locale: Locale): DateFormatters {
  const formatter = createFormatter({ locale, timeZone: 'UTC' });

  return {
    fullDate: (date) =>
      formatter.dateTime(toUtcMidnight(date), {
        timeZone: 'UTC',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),

    dayMonthAndYear: (date) =>
      formatter.dateTime(toUtcMidnight(date), {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),

    dayAndMonth: (date) =>
      formatter.dateTime(toUtcMidnight(date), {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'long',
      }),

    monthAndYear: (date) =>
      formatter.dateTime(toUtcMidnight(date), {
        timeZone: 'UTC',
        month: 'long',
        year: 'numeric',
      }),

    monthName: (month) =>
      // The reference year and day are never read — only the month component
      // is — but must form a real calendar date, hence day 1.
      formatter.dateTime(new Date(Date.UTC(2000, month - 1, 1)), {
        timeZone: 'UTC',
        month: 'long',
      }),

    // Czech needs a hand-written table because CLDR carries only the `format`
    // (genitive) and `stand-alone` (nominative) forms, and the locative is
    // neither — see `./dates.ts`. English declines nothing, so the standalone
    // month name is already the form that reads after "in".
    //
    // Out of range throws, in both languages, exactly as `formatMonthLocative`
    // did: this value goes into the middle of a sentence, and an empty string
    // there is a silent hole where a caller bug should have been loud.
    monthLocative: (month) => {
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new RangeError(`Not a month number (1–12): ${String(month)}`);
      }
      if (locale === 'cs') {
        // Non-null: the range was just checked, and the table has 12 entries.
        return MONTH_LOCATIVE_CS[month - 1] as string;
      }
      return formatter.dateTime(new Date(Date.UTC(2000, month - 1, 1)), {
        timeZone: 'UTC',
        month: 'long',
      });
    },

    weekdayName: (date) =>
      formatter.dateTime(toUtcMidnight(date), { timeZone: 'UTC', weekday: 'long' }),

    year: (year) => String(year),
  };
}

/**
 * One `DateFormatters` per locale, built on first use.
 *
 * Memoised because `createFormatter` builds `Intl` objects, which are
 * expensive enough that a per-render call shows up in a table of 30 rows —
 * and because reference stability lets a `useMemo` downstream hold.
 */
const cache = new Map<Locale, DateFormatters>();

export function createDateFormatters(locale: Locale): DateFormatters {
  const cached = cache.get(locale);
  if (cached !== undefined) {
    return cached;
  }
  const built = build(locale);
  cache.set(locale, built);
  return built;
}

/**
 * The formatters for the locale on the provider.
 *
 * For components. Pure view modules (`apps/garage/web/src/lot/lot-view.ts`,
 * `apps/garage/web/src/shell/admin/window-banner/window-view.ts`) are not components
 * and take a `DateFormatters` as a parameter instead — which is also what makes
 * their tests able to assert both languages without a React tree.
 */
export function useDateFormatters(): DateFormatters {
  const locale = useLocale();
  return createDateFormatters(isLocale(locale) ? locale : DEFAULT_LOCALE);
}
