/**
 * The `ical-generator` wrapper: reservations in, one RFC 5545 document out.
 *
 * This module is the **only** place in the workspace allowed to import
 * `ical-generator` (`eslint.config.mjs`, `WRAPPED_LIBRARIES`). Everything else
 * asks for `@garage/calendar-export`.
 *
 * ## Why it is a pure function and not a Nest service
 *
 * Nothing here reads a clock, a database or an environment variable. The input
 * is a contract value (`IcsFeed`) and the output is a string, which makes the
 * whole rendering testable without a server and — more importantly — makes the
 * body **deterministic**: the same reservations always produce the same bytes,
 * so Express can compute a strong-enough `ETag` and answer a polling calendar
 * client with `304 Not Modified` (`doc/decision/0081-*`). A `DTSTAMP` of "now"
 * would defeat that on every single request.
 *
 * ## The calendar's time zone is deliberately unset
 *
 * `ical-generator` accepts a `timezone` on the calendar, and setting it to
 * `Europe/Prague` — which reads as obviously correct — makes the output depend
 * on the **server's** `TZ`. Probed at 11.1.1: with `timezone` set and
 * `TZ=America/Los_Angeles`, a reservation for `2026-10-15` renders as
 * `DTSTART;VALUE=DATE:20261014` and `DTSTAMP` loses its `Z`. With no calendar
 * time zone and UTC-midnight `Date` values, the output is byte-identical under
 * `UTC`, `America/Los_Angeles`, `Europe/Prague` and `Pacific/Kiritimati`.
 * `reservation-calendar.spec.ts` pins that by flipping `process.env.TZ`.
 *
 * This does not weaken the Europe/Prague rule: a reservation day is a *calendar
 * day* (`doc/decision/0013-calendar-arithmetic-and-single-timezone-boundary`), an all-day `VALUE=DATE` event carries no time
 * and therefore no offset, and the conversion from a stored `@db.Date` to
 * `YYYY-MM-DD` already happened in `apps/garage/api`.
 */

import icalGenerator, { ICalCalendarMethod } from 'ical-generator';
import type { IcsCalendarEntry, IcsFeed } from '@garage/contract';
import { addDays, toUtcMidnight } from '@garage/shared-types';

/**
 * `X-WR-CALNAME` / `NAME` — what a calendar client labels the subscription.
 *
 * Czech, like the rest of the UI: this string is read by an employee in
 * Outlook, so it is UI copy, and `CLAUDE.md` keeps UI copy Czech. It lives here
 * rather than in `libs/shared/i18n` because `libs/shared/i18n` is `scope:web` and the Nx
 * boundary rule forbids `apps/garage/api` from reaching it — see
 * `doc/decision/0082-*`.
 */
export const ICS_CALENDAR_NAME = 'Parkování';

/**
 * How often a subscribed client is asked to re-fetch, as
 * `REFRESH-INTERVAL;VALUE=DURATION` and Microsoft's `X-PUBLISHED-TTL`.
 *
 * One hour. It is a *hint* — Outlook and Google both apply their own floor, and
 * neither is obliged to honour it — so a shorter value buys nothing but load.
 * A reservation made today is for a future day, so an hour late is never a
 * missed morning.
 *
 * Seconds, not milliseconds: this is not an env variable (see
 * `doc/environment.md`'s `_MS` rule), it is the unit `ical-generator`'s `ttl`
 * option takes.
 */
export const ICS_REFRESH_INTERVAL_SECONDS = 3600;

/**
 * Domain part of every event `UID`.
 *
 * A `UID` must be globally unique and **stable**: it is what tells a calendar
 * client "this is the same event you already have" rather than a second copy.
 * The local part is the reservation's own UUIDv7, which is already globally
 * unique, so this suffix exists only to satisfy the addr-spec shape clients
 * expect. It is a constant rather than the request's `Host` on purpose — a
 * `UID` that changed when the API moved behind a new hostname would duplicate
 * every event in every subscriber's calendar.
 */
export const ICS_UID_DOMAIN = 'garage';

/**
 * The event's `SUMMARY`, i.e. the line the employee sees in their calendar.
 *
 * Czech UI copy. The en dash and the spot label are the whole content: a
 * calendar row is narrow, and "which spot" is the only thing the reservation
 * adds to a day the person already knows about.
 */
export function icsEventSummary(spotLabel: string): string {
  return `Parkování – ${spotLabel}`;
}

/** The event's `DESCRIPTION`. Czech UI copy, for the same reason. */
export function icsEventDescription(spotLabel: string): string {
  return `Rezervované parkovací místo ${spotLabel}.`;
}

/** The event's `UID`: stable for the life of the reservation. */
export function icsEventUid(reservationId: string): string {
  return `${reservationId}@${ICS_UID_DOMAIN}`;
}

/**
 * Renders one user's reservations as an RFC 5545 `VCALENDAR` document.
 *
 * Every event is all-day: a reservation is a calendar day, not an interval, and
 * a person's working hours are not this application's business. `DTEND` is set
 * to the following day (exclusive, as RFC 5545 requires for `VALUE=DATE`)
 * rather than left off — `ical-generator` omits it entirely when `end` is
 * absent, and several clients render a bare `DTSTART;VALUE=DATE` as a
 * zero-length item.
 *
 * The order of `entries` is preserved; the caller decides it.
 */
export function buildReservationCalendar(feed: IcsFeed): string {
  const calendar = icalGenerator({
    name: ICS_CALENDAR_NAME,
    // `-//garage//parking//CS`. Identifies the producer, as RFC 5545 §3.7.3
    // requires; it is not a hostname and nothing resolves it.
    prodId: { company: 'garage', product: 'parking', language: 'CS' },
    // A one-way published feed, never an invitation. Outlook in particular
    // treats a `METHOD`-less calendar inconsistently.
    method: ICalCalendarMethod.PUBLISH,
    ttl: ICS_REFRESH_INTERVAL_SECONDS,
    // No `timezone` — see the module header. This is the line whose absence is
    // load-bearing.
  });

  for (const entry of feed.entries) {
    addEvent(calendar, entry);
  }

  return calendar.toString();
}

function addEvent(calendar: ReturnType<typeof icalGenerator>, entry: IcsCalendarEntry): void {
  // `toUtcMidnight` is `libs/garage/shared-types`' one construction of the
  // UTC-midnight `Date` that stands in for a calendar day — the value
  // `ical-generator` renders as `VALUE=DATE`. `DTEND` is the *next* calendar
  // day, taken through `addDays` rather than by adding 86 400 000 ms, so the
  // exclusive end is civil-calendar arithmetic like every other date in the
  // workspace instead of a second, local rule.
  calendar.createEvent({
    id: icsEventUid(entry.reservationId),
    start: toUtcMidnight(entry.date),
    end: toUtcMidnight(addDays(entry.date, 1)),
    allDay: true,
    summary: icsEventSummary(entry.spotLabel),
    description: icsEventDescription(entry.spotLabel),
    location: entry.spotLabel,
    // `DTSTAMP` is the reservation's own creation time, never `new Date()`.
    // That is what keeps the whole document a pure function of the data.
    stamp: new Date(entry.createdAt),
  });
}
