/**
 * The only place in the workspace that maps between instants and calendar days
 * in Europe/Prague (see `doc/decision/0003-date-helpers-in-shared-types.md`).
 *
 * Europe/Prague is UTC+1 in winter and UTC+2 in summer, so "what day is it"
 * cannot be answered by reading a `Date` in the process' local time zone, nor
 * by adding a fixed offset to UTC. Both functions below therefore delegate the
 * zone rules to the ICU database via `Intl.DateTimeFormat`, which makes the
 * result identical on a server running in UTC and on a laptop in Prague.
 */

import { addDays, formatDateOnly, parseDateOnly, type DateOnly, type DateParts } from './date-only';

/** IANA identifier of the single time zone this application operates in. */
export const PRAGUE_TIME_ZONE = 'Europe/Prague';

const PRAGUE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PRAGUE_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface ZonedParts extends DateParts {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Wall-clock parts of `instant` as seen in Europe/Prague. */
function pragueParts(instant: Date): ZonedParts {
  const parts = PRAGUE_PARTS_FORMATTER.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new Error(`Intl did not return the "${type}" part for ${PRAGUE_TIME_ZONE}`);
    }
    return Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // `hourCycle: 'h23'` keeps midnight as 0 instead of 24.
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of Europe/Prague from UTC, in milliseconds, at the given instant. */
function pragueOffsetMs(instant: Date): number {
  const { year, month, day, hour, minute, second } = pragueParts(instant);
  const asUtc = new Date(0);
  asUtc.setUTCFullYear(year, month - 1, day);
  asUtc.setUTCHours(hour, minute, second, instant.getUTCMilliseconds());
  return asUtc.getTime() - instant.getTime();
}

/**
 * The calendar day `instant` falls on in Europe/Prague.
 *
 * `2026-08-27T22:30:00Z` is already `2026-08-28` in Prague (CEST, UTC+2).
 */
export function toDateOnlyInPrague(instant: Date): DateOnly {
  // `ZonedParts extends DateParts`, so `formatDateOnly` serializes it directly.
  // Its normalization of out-of-range parts is a no-op here: `Intl` only ever
  // emits an in-range year, month and day.
  return formatDateOnly(pragueParts(instant));
}

/**
 * Today's calendar day in Europe/Prague.
 *
 * `now` exists so that domain code and tests can inject an instant instead of
 * reaching for the clock; production callers omit it.
 */
export function todayInPrague(now: Date = new Date()): DateOnly {
  return toDateOnlyInPrague(now);
}

/**
 * The instant at which the given calendar day starts in Europe/Prague
 * (local midnight), for use as the lower bound of a timestamp range query.
 *
 * Derived by guessing the instant as if the wall clock were UTC and then
 * correcting by the zone offset. The correction is applied twice because the
 * offset at the guess and the offset at the corrected instant can differ
 * across a DST transition; the second pass settles it.
 */
export function startOfDayInPrague(date: DateOnly): Date {
  const { year, month, day } = parseDateOnly(date);
  const guess = new Date(0);
  guess.setUTCFullYear(year, month - 1, day);
  guess.setUTCHours(0, 0, 0, 0);

  const firstPass = new Date(guess.getTime() - pragueOffsetMs(guess));
  const secondPass = new Date(guess.getTime() - pragueOffsetMs(firstPass));
  return secondPass;
}

/**
 * The instant at which the given calendar day ends in Europe/Prague, exclusive
 * (i.e. local midnight of the following day). Pairs with
 * `startOfDayInPrague` as a half-open `[start, end)` range.
 */
export function endOfDayExclusiveInPrague(date: DateOnly): Date {
  return startOfDayInPrague(addDays(date, 1));
}
