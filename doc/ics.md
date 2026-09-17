# The personal ICS feed

Every employee has one calendar subscription URL that shows the days they have a
parking spot. This document is what that endpoint is, what it serves, how it is
authenticated, and what has actually been verified about it.

Companion documents: `doc/api-modules.md` (the other API modules and how errors
become responses), `doc/api-operations.md` (logging, probes, rate limiting),
`doc/wrappers.md` (why `ical-generator` is behind a wrapper lib),
`doc/contract.md` (the contract, of which this endpoint owns only the URL shape).

---

## 1. The endpoint

```
GET /api/calendar/<icsToken>.ics
```

No `Authorization` header. No cookie. The 32-byte `randomBytes` token in the
path is the entire credential.

| | |
| --- | --- |
| Success | `200`, `Content-Type: text/calendar; charset=utf-8` |
| Anything unservable | `404`, `{"statusCode":404,"message":"Not Found"}` |
| Too many requests | `429`, `{"statusCode":429,"message":"ThrottlerException: Too Many Requests"}` |

**This is the one route outside the oRPC contract**, and the exemption is named
in `plan.md` §Contract-first. A calendar client subscribes by pasting a URL: it
sends no header it can be taught, it cannot read the `{ json, meta }` RPC
envelope, and it wants `text/calendar` rather than JSON. Nothing else in the
application bypasses the contract, and the contract still owns everything it can
here — the URL's shape (`ICS_FEED_BASE_PATH`, `buildIcsFeedPath`,
`buildIcsFeedUrl`) and the data that goes into the calendar
(`icsCalendarEntrySchema`), both in `libs/garage/contract/src/api/ics.ts`.

Never build the URL by hand:

```ts
import { buildIcsFeedUrl } from '@garage/contract';

buildIcsFeedUrl('https://parking.example.com', profile.icsToken);
// → https://parking.example.com/api/calendar/<token>.ics
```

### Response headers on a success

| header | value | why |
| --- | --- | --- |
| `Content-Type` | `text/calendar; charset=utf-8` | RFC 5545 §8.1. The charset is not optional — the copy is Czech. |
| `Cache-Control` | `private, max-age=300, must-revalidate` | `private` is the load-bearing word: the URL *is* the credential, so no shared cache may hold the body. |
| `Content-Disposition` | `attachment; filename="garage.ics"` | What a browser opening the URL directly gets. |
| `X-Robots-Tag` | `noindex, nofollow` | The URL is a secret; if one is ever pasted somewhere crawlable, do not publish it. |
| `ETag` | Express's weak ETag | See §4. |

**None of these headers is set on a rejection**, and that is deliberate — see §3.

---

## 2. What the feed contains

One all-day event per reservation the caller holds.

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//garage//parking//CS
METHOD:PUBLISH
NAME:Parkování
X-WR-CALNAME:Parkování
REFRESH-INTERVAL;VALUE=DURATION:PT1H
X-PUBLISHED-TTL:PT1H
BEGIN:VEVENT
UID:0199c0f0-3a1a-7000-8000-00000000000a@garage
SEQUENCE:0
DTSTAMP:20260901T083000Z
DTSTART;VALUE=DATE:20261015
DTEND;VALUE=DATE:20261016
X-MICROSOFT-CDO-ALLDAYEVENT:TRUE
X-MICROSOFT-MSNCALENDAR-ALLDAYEVENT:TRUE
SUMMARY:Parkování – E2.92
LOCATION:E2.92
DESCRIPTION:Rezervované parkovací místo E2.92.
END:VEVENT
END:VCALENDAR
```

- **All-day, never an interval.** A reservation is a *calendar day*
  (`doc/decision/0013-calendar-arithmetic-and-single-timezone-boundary`); what hours somebody works is not this application's
  business. `DTEND` is the following day because RFC 5545 §3.8.2.2 makes it
  exclusive for a `VALUE=DATE`, and because `ical-generator` omits the property
  entirely when `end` is not passed — which several clients render as a
  zero-length item.
- **`UID` is the reservation's own UUIDv7** plus a constant `@garage`. It is
  stable for the life of the reservation and survives a token regeneration, so a
  re-subscribing client updates its events instead of duplicating them. It is
  deliberately *not* derived from the request's `Host`: moving the API behind a
  new hostname would otherwise duplicate every event in every calendar.
- **`DTSTAMP` is the reservation's `createdAt`**, never "now". That is what makes
  the document a pure function of the data — see §4 and `doc/decision/0081-*`.
- **The copy is Czech and lives in `libs/garage/calendar-export`**, not in `libs/shared/i18n`
  (which is `scope:web` and unreachable from the API): `doc/decision/0082-*`.
- **The parking group is not shown.** It has no Czech label anywhere in the
  workspace, and the spot label is what a person reads off the asphalt.
- **The calendar carries no time zone at all.** Setting one makes the output
  depend on the *server's* `TZ` — `doc/decision/0081-*` has the measurements.

### Which reservations

Everything the caller holds from **30 days ago** (`ICS_FEED_PAST_DAYS`, measured
in Europe/Prague) onwards, ordered by date and then by id.

There is no forward bound: the reservation window already caps how far ahead
anything can be booked, so a second horizon here could only hide a reservation
somebody really holds. The backward bound is not zero because a calendar that
drops yesterday the moment midnight passes looks, to the person subscribed, like
their history is being deleted — and a client that syncs the entry away cannot
get it back.

A user with no reservations gets a **valid, event-free** calendar, not a 404. A
client that receives a parse error unsubscribes.

---

## 3. Authentication, and why every failure is a 404

`@Public()`, because there is no bearer token to check
(`apps/garage/api/src/auth/public.decorator.ts` lists this as one of the two legitimate
uses). `@StrictThrottle()`, because that makes it the one route an
unauthenticated stranger can reach with a payload of their choosing:
`THROTTLE_STRICT_LIMIT` requests per `THROTTLE_STRICT_TTL_MS` — **20 per
minute** by default — against the default tier's 300.

The token is resolved by a single query:

```ts
prisma.client.user.findFirst({ where: { icsToken, active: true }, select: { id: true } })
```

`null` → `404`. Three things follow, and each is there for a reason:

1. **A deactivated user's token stops working**, because offboarding is
   `active: false` and the filter is in the `WHERE` clause rather than in an
   `if` afterwards. Same statement, same branch, same response as an unknown
   token — so the two cannot be told apart by timing either.
2. **404 and not 401.** A 401 on a wrong token beside a 404 on a wrong path
   would partition the token space by response code. `doc/decision/0080-*`.
3. **No header a served feed would carry appears on a rejection.** `@Header()`
   decorators are applied *before* the handler runs, so the obvious
   implementation leaks `Content-Type: text/calendar` and a `Cache-Control` onto
   every bad token. The headers are set inside the handler instead.

**Regenerating the token invalidates the old URL immediately.** `me.regenerateIcsToken`
(`doc/api-modules.md` §6) writes a new `icsToken`; the next request to the old
URL finds no row and gets the same 404 as any other unknown token. This is
tested, not assumed — `calendar-pipeline.spec.ts` fetches the feed, regenerates,
and then asserts the old URL is 404 while the new one serves the same events with
the same `UID`s.

### What is *not* claimed

The endpoint is not constant-time, and a rejection is not byte-identical to
Nest's own router 404 (which echoes the unmatched path). Both are stated, with
their reasoning, in `doc/decision/0080-*` §"What this deliberately does not
claim".

---

## 4. Caching

The rendered document is a pure function of the reservations, so:

- Express computes a weak `ETag` from the body,
- a client sending `If-None-Match` gets `304 Not Modified` with no body,
- and the response is `private, max-age=300, must-revalidate`, comfortably below
  the `REFRESH-INTERVAL: PT1H` the calendar advertises to subscribers.

> **Careful when testing this.** Node's `fetch` (undici) attaches
> `cache-control: no-cache` **and** `pragma: no-cache` to any request carrying
> an `if-none-match` header, and Express's `fresh` module correctly treats that
> as a demand for a full response (RFC 9111 §5.2.1.4). A `fetch`-based test of
> the 304 reads `200` while the server is behaving perfectly. Use `node:http` —
> `calendar-pipeline.spec.ts` does, with the reason beside it.

`max-age` is not configurable. It is a product decision about how fresh a
calendar should be, identical on every deployment, and `doc/environment.md`'s env
surface is for values that differ between them.

---

## 5. Where the code is

| file | what it owns |
| --- | --- |
| `libs/garage/contract/src/api/ics.ts` | `ICS_FEED_BASE_PATH`, `buildIcsFeedPath`, `buildIcsFeedUrl`, `icsCalendarEntrySchema`, `icsFeedSchema` |
| `libs/garage/calendar-export/src/lib/reservation-calendar.ts` | `buildReservationCalendar` — the **only** importer of `ical-generator` in the workspace |
| `apps/garage/api/src/calendar/calendar.service.ts` | resolving the token, selecting the reservations, `ICS_FEED_PAST_DAYS` |
| `apps/garage/api/src/calendar/calendar.controller.ts` | the route, `@Public()`, `@StrictThrottle()`, the response headers |

`ical-generator` may not be imported anywhere else. That is enforced, not merely
documented — `eslint.config.mjs`'s `WRAPPED_LIBRARIES`, probed from `apps/garage/api`
and from `libs/shared/form`:

```
error  'ical-generator' import is restricted from being used by a pattern.
Do not import "ical-generator" directly — use the wrapper lib
@garage/calendar-export (libs/garage/calendar-export). Only libs/garage/calendar-export
may import "ical-generator"   no-restricted-imports
```

---

## 6. How it is tested

Three layers, and the division is deliberate.

- **`libs/garage/calendar-export/src/lib/reservation-calendar.spec.ts`** — the
  rendering. Every assertion reads the output back through **`ical.js`**,
  Mozilla's RFC 5545 parser, never through a regular expression or a string the
  test wrote. A test that compares the builder's output to a template the same
  author wrote proves the template equals itself. Includes line folding under
  Czech diacritics, `TEXT` escaping of `,` `;` `\`, and a **child-process**
  check that the output is identical under four server time zones.
- **`apps/garage/api/src/calendar/calendar.service.spec.ts`** — the selection: whose
  reservations, in what order, within what horizon, and the four rejection cases.
- **`apps/garage/api/src/calendar/calendar-pipeline.spec.ts`** — the assembled
  application over real HTTP: that `@Public()` fires under a global
  `JwtAuthGuard`, that Express's path parser really splits `:icsToken` from the
  `.ics` suffix, that the strict throttler admits two requests and refuses the
  third, that the bytes on the wire parse as a calendar, and that a rejection is
  header-for-header the same as an unrouted 404.
- **`apps/garage/api/src/calendar/calendar.db.spec.ts`** — part of `nx run api:test-db`,
  against a **real PostgreSQL 17**. Two claims here are about Prisma 7 with
  `@prisma/adapter-pg` rather than about our logic, and a double cannot settle
  either: that `findFirst({ icsToken, active: true })` really authenticates and
  really refuses a deactivated user, and that a `@db.Date` round-trips through
  `toDateOnly` unchanged on both Europe/Prague DST transition days and on a leap
  day.

```
docker compose --profile dev up -d
nx run api:test-db
```

### Two tests that once passed for the wrong reason

Recorded because the mistake is easy to repeat, and both were found by breaking
the source rather than by reading it:

- `ICAL.Event.endDate` applies the RFC's default (start + one day for a `DATE`
  value) when `DTEND` is absent, so the parsed `endDate` and `duration`
  assertions passed with **no `DTEND` written at all**. The suite now also
  asserts the raw property is present.
- `ical-generator` truncates `DTSTAMP` to whole seconds, so a purity test that
  called the builder twice in a row passed even with `stamp: new Date()`. It now
  moves the system clock between the two calls.

---

## 7. Subscribing

Outlook: *Add calendar → Subscribe from web*, paste the URL. Google Calendar:
*Other calendars → From URL*. Apple Calendar: *File → New Calendar
Subscription*.

Both Outlook and Google apply their own refresh floor and will ignore
`REFRESH-INTERVAL` if it is shorter than theirs; an hour is already above both.

Anyone who obtains the URL sees that person's parking days — that is the whole
security model, and it is why regenerating the token exists. Tell people to treat
it like a password.

The app does not log it. That is now a property with a test behind it rather than
an intention: the token is in the **URL**, and a URL is the one thing every HTTP
logger writes by default, so it had to be redacted at four separate sites —
`req.url` and `req.params` in the per-request line, and `path` and `reason` in
`ContractExceptionFilter`'s rejection line, the last of which carries the URL
inside Nest's own `Cannot GET …` message. `redactIcsToken`
(`apps/garage/api/src/logging/redact-ics-token.ts`) does all four, and
`calendar-logging.spec.ts` boots the application at `LOG_LEVEL: 'info'`, sends real
requests and asserts on the bytes pino emitted. It is the only spec in the
workspace that reads log output; every other one pins `LOG_LEVEL: 'fatal'`, which
is why the leak survived the first draft of this task.

The audit trail is separate and was always fine: the entry for a regeneration
records *that* it happened, never the token (`doc/api-modules.md` §3).
