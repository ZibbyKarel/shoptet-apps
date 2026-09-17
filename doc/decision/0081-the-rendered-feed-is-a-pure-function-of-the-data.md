# 0081 — The rendered feed is a pure function of the data, so `ETag` works

## What

`buildReservationCalendar(feed)` takes contract values and returns a string,
with no clock read anywhere inside it. In particular each event's `DTSTAMP` is
the **reservation's** `createdAt`, not `new Date()`, and the calendar carries no
`timezone` (see below). The same reservations therefore always render to the
same bytes.

The controller returns that string from the handler rather than writing it to
`@Res()`, so Express's own `res.send()` computes a weak `ETag` and answers a
conditional re-fetch with `304 Not Modified`.

## Why

A calendar client is a **poller**. Outlook and Google re-fetch a subscription
every few minutes to a few hours, forever, per subscriber, and almost every one
of those fetches finds nothing new. Making the body deterministic turns that
traffic into a header exchange: the client sends `If-None-Match`, Express
compares the ETag, and the response is 304 with no body.

Determinism is the whole prerequisite. With `DTSTAMP: new Date()` every response
would be a different string, every ETag would be new, and `304` could never
fire — while looking, in casual testing, exactly like a working implementation.

There is a second benefit worth naming: a deterministic renderer is testable by
comparison. `reservation-calendar.spec.ts` can assert that the same feed renders
identically across a year of simulated wall-clock, and — via child processes —
across four server time zones. Neither test is possible against a builder that
reads the clock.

`DTSTAMP` = `createdAt` is also the *correct* value, not merely a convenient
one. RFC 5545 §3.8.7.2 defines it, for a `PUBLISH` calendar, as when the
information was created — which for a reservation is when it was made.

## The trap this decision walked into twice

Both were found by breaking the code and watching what did *not* fail.

1. **`ical-generator` formats `DTSTAMP` to whole seconds.** The first version of
   the purity test called the builder twice in a row and compared. With `stamp:
   new Date()` substituted, both calls landed in the same second and the test
   still passed. It now moves the system clock between the two calls with
   `jest.useFakeTimers()`, and kills that mutation.
2. **Node's `fetch` cannot test the 304 at all.** Undici attaches
   `cache-control: no-cache` *and* `pragma: no-cache` to any request carrying an
   `if-none-match` header, and Express's `fresh` module correctly treats a
   request `cache-control: no-cache` as a demand for a full response (RFC 9111
   §5.2.1.4). The `fetch`-based test therefore read `200` while the server was
   behaving perfectly. The pipeline spec issues that one request with `node:http`
   instead, and says why in a comment beside it.

## The calendar has no `timezone`, and that absence is load-bearing

`ical-generator` accepts `timezone: 'Europe/Prague'` on the calendar, which reads
as obviously right for this application and is wrong. Probed at 11.1.1: with it
set and the process running under `TZ=America/Los_Angeles`, a reservation for
`2026-10-15` renders as `DTSTART;VALUE=DATE:20261014` and `DTSTAMP` loses its
trailing `Z`, becoming a floating time rendered in the server's local zone.

With no calendar time zone and UTC-midnight `Date` values, the output is
byte-identical under `UTC`, `America/Los_Angeles`, `Europe/Prague` and
`Pacific/Kiritimati`. This does not weaken the Europe/Prague rule: a reservation
day is a calendar day (`doc/decision/0013-calendar-arithmetic-and-single-timezone-boundary`), an all-day `VALUE=DATE` event has
no time and therefore no offset, and the `@db.Date` → `YYYY-MM-DD` conversion has
already happened in `apps/garage/api`.

Adding `timezone: 'Europe/Prague'` fails **2** tests; changing `DTSTAMP` to
`new Date()` fails **3**.

## How

- `libs/garage/calendar-export/src/lib/reservation-calendar.ts` — no clock, no calendar
  `timezone`, `stamp: new Date(entry.createdAt)`.
- `libs/garage/contract/src/api/ics.ts` — `createdAt` is part of `icsCalendarEntrySchema`
  for this reason.
- `apps/garage/api/src/calendar/calendar.controller.ts` — `@Res({ passthrough: true })`
  and a returned string, so `res.send()` runs.
- `apps/garage/api/src/calendar/calendar.service.ts` — `orderBy: [{ date: 'asc' }, { id:
  'asc' }]`; without the `id` tiebreaker two reservations on the same day could
  swap places between reads and change the ETag for no reason.
