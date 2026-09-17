/**
 * Every assertion here reads the generated feed back through **`ical.js`**,
 * Mozilla's RFC 5545 parser (the one Thunderbird ships), never through a
 * regular expression or a string this file wrote.
 *
 * That is the whole point. A calendar client is the consumer of this output; a
 * test that compares `buildReservationCalendar(...)` against a template we also
 * wrote proves the template equals itself and would survive any change that
 * broke both together. Parsing proves the bytes are a document, that its
 * properties land where RFC 5545 says they do, and that `2026-10-15` comes back
 * out as the fifteenth.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import ICAL from 'ical.js';
import type { IcsCalendarEntry } from '@garage/contract';
import { icsCalendarEntrySchema } from '@garage/contract';
import {
  ICS_CALENDAR_NAME,
  ICS_REFRESH_INTERVAL_SECONDS,
  buildReservationCalendar,
  icsEventDescription,
  icsEventSummary,
  icsEventUid,
} from './reservation-calendar';

const RESERVATION_A = '0199c0f0-3a1a-7000-8000-00000000000a';
const RESERVATION_B = '0199c0f0-3a1a-7000-8000-00000000000b';

function entry(overrides: Partial<IcsCalendarEntry> = {}): IcsCalendarEntry {
  // Parsed through the contract schema so a fixture can never be a shape the
  // contract would reject.
  return icsCalendarEntrySchema.parse({
    reservationId: RESERVATION_A,
    date: '2026-10-15',
    createdAt: '2026-09-01T08:30:00.000Z',
    spotLabel: 'E2.92',
    ...overrides,
  });
}

/**
 * `ical.js` publishes a single default export whose members are classes, so the
 * instance types have to be recovered with `InstanceType` — there is no
 * `ICAL.Component` type to write.
 */
type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalDuration = InstanceType<typeof ICAL.Duration>;
type IcalTime = InstanceType<typeof ICAL.Time>;

/** The `VCALENDAR` component, as a parser that has never seen our source reads it. */
function parseCalendar(ics: string): IcalComponent {
  return new ICAL.Component(ICAL.parse(ics));
}

function eventsOf(ics: string): IcalComponent[] {
  return parseCalendar(ics).getAllSubcomponents('vevent');
}

/** The single `VEVENT`, failing loudly rather than reading `undefined`. */
function onlyEventComponent(ics: string): IcalComponent {
  const events = eventsOf(ics);
  if (events.length !== 1) {
    throw new Error(`Expected exactly one VEVENT, found ${events.length}`);
  }
  return events[0] as IcalComponent;
}

function onlyEvent(ics: string): InstanceType<typeof ICAL.Event> {
  return new ICAL.Event(onlyEventComponent(ics));
}

/** Zones chosen to straddle UTC in both directions, including one past the date line. */
const TIME_ZONES = ['UTC', 'America/Los_Angeles', 'Europe/Prague', 'Pacific/Kiritimati'] as const;

interface RenderedInTimeZone {
  timeZone: string;
  /** Local hour of `2026-10-15T00:00:00Z`, i.e. proof the child really is in that zone. */
  localHour: number;
  ics: string;
}

/** Renders the fixed one-entry feed in a fresh Node process pinned to `timeZone`. */
function renderInTimeZone(timeZone: string): RenderedInTimeZone {
  const script = `
    const { buildReservationCalendar } = require(${JSON.stringify(
      require.resolve('./reservation-calendar.ts')
    )});
    process.stdout.write(JSON.stringify({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localHour: new Date('2026-10-15T00:00:00.000Z').getHours(),
      ics: buildReservationCalendar({ entries: ${JSON.stringify([
        {
          reservationId: RESERVATION_A,
          date: '2026-10-15',
          createdAt: '2026-09-01T08:30:00.000Z',
          spotLabel: 'E2.92',
        },
      ])} }),
    }));
  `;

  const result = execFileSync(
    process.execPath,
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', '-e', script],
    {
      cwd: __dirname,
      encoding: 'utf8',
      env: {
        ...process.env,
        TZ: timeZone,
        TS_NODE_TRANSPILE_ONLY: 'true',
        TS_NODE_COMPILER_OPTIONS: JSON.stringify({ module: 'commonjs', target: 'es2022' }),
        // `tsconfig-paths` needs the file that actually carries `paths` — the
        // workspace root's, not the nearest one to `cwd`. Without it the child
        // cannot resolve `@garage/shared-types` and dies with
        // MODULE_NOT_FOUND before rendering a single line of ICS.
        TS_NODE_PROJECT: resolve(__dirname, '../../../../../tsconfig.base.json'),
      },
    }
  );

  return JSON.parse(result) as RenderedInTimeZone;
}

describe('buildReservationCalendar', () => {
  it('produces a document ical.js can parse, with the required VCALENDAR properties', () => {
    const calendar = parseCalendar(buildReservationCalendar({ entries: [entry()] }));

    expect(calendar.name).toBe('vcalendar');
    // RFC 5545 §3.6: VERSION and PRODID are mandatory on a VCALENDAR.
    expect(calendar.getFirstPropertyValue('version')).toBe('2.0');
    expect(calendar.getFirstPropertyValue('prodid')).toBe('-//garage//parking//CS');
    // A published, read-only feed — never an invitation.
    expect(calendar.getFirstPropertyValue('method')).toBe('PUBLISH');
  });

  it('names the subscription in Czech, the language of the UI', () => {
    const calendar = parseCalendar(buildReservationCalendar({ entries: [] }));

    expect(ICS_CALENDAR_NAME).toBe('Parkování');
    // Both spellings: `X-WR-CALNAME` is what Google and Outlook read, `NAME` is
    // the standardised one (RFC 7986).
    expect(calendar.getFirstPropertyValue('x-wr-calname')).toBe(ICS_CALENDAR_NAME);
    expect(calendar.getFirstPropertyValue('name')).toBe(ICS_CALENDAR_NAME);
  });

  it('asks subscribers to re-fetch on the documented interval', () => {
    const calendar = parseCalendar(buildReservationCalendar({ entries: [] }));

    const refresh = calendar.getFirstPropertyValue('refresh-interval') as IcalDuration;
    expect(refresh.toSeconds()).toBe(ICS_REFRESH_INTERVAL_SECONDS);
    // Microsoft's non-standard spelling of the same hint.
    expect(String(calendar.getFirstPropertyValue('x-published-ttl'))).toBe('PT1H');
  });

  it('renders an empty feed as a valid, event-free calendar', () => {
    // A user with no reservations must still get a subscribable document —
    // a client that receives a parse error unsubscribes.
    const ics = buildReservationCalendar({ entries: [] });

    expect(() => parseCalendar(ics)).not.toThrow();
    expect(eventsOf(ics)).toHaveLength(0);
  });

  describe('one reservation', () => {
    const ics = buildReservationCalendar({ entries: [entry()] });

    it('is an all-day event on exactly the reserved calendar day', () => {
      const event = onlyEvent(ics);

      // `isDate` is ical.js reporting `VALUE=DATE` — a calendar day with no
      // time and therefore no time zone, which is what a reservation is.
      expect(event.startDate.isDate).toBe(true);
      expect(event.startDate.toString()).toBe('2026-10-15');
      expect(event.endDate.isDate).toBe(true);
      // RFC 5545 §3.8.2.2: DTEND on a DATE value is exclusive, so one day long
      // is `2026-10-16`.
      expect(event.endDate.toString()).toBe('2026-10-16');
      expect(event.duration.toString()).toBe('P1D');
      // …and `DTEND` is really written, not merely inferred. `ICAL.Event`
      // applies the RFC default (start + one day for a DATE value) when the
      // property is absent, so `endDate` and `duration` above both read
      // `2026-10-16` / `P1D` even with no `DTEND` in the document at all —
      // proved by deleting `end:` from the builder and watching only the
      // line-level check fail. Several clients render a bare `DTSTART;VALUE=DATE`
      // as a zero-length item, so the property has to be there.
      expect(onlyEventComponent(ics).getFirstProperty('dtend')).not.toBeNull();
    });

    it('carries the Czech summary, description and the spot as the location', () => {
      const event = onlyEvent(ics);

      expect(event.summary).toBe('Parkování – E2.92');
      expect(event.description).toBe('Rezervované parkovací místo E2.92.');
      expect(event.location).toBe('E2.92');
    });

    it('uses the reservation id as a stable UID', () => {
      const event = onlyEvent(ics);

      expect(event.uid).toBe(`${RESERVATION_A}@garage`);
      expect(event.uid).toBe(icsEventUid(RESERVATION_A));
    });

    it('stamps the event with the reservation’s creation time, not with now', () => {
      const dtstamp = onlyEventComponent(ics).getFirstPropertyValue('dtstamp') as IcalTime;

      expect(dtstamp.toJSDate().toISOString()).toBe('2026-09-01T08:30:00.000Z');
    });

    it('survives a round trip: parsed and re-serialised, it still says the same thing', () => {
      const reserialised = parseCalendar(ics).toString();
      const event = onlyEvent(reserialised);

      expect(event.summary).toBe('Parkování – E2.92');
      expect(event.startDate.toString()).toBe('2026-10-15');
    });
  });

  it('renders every entry, in the order it was given', () => {
    const ics = buildReservationCalendar({
      entries: [
        entry({ reservationId: RESERVATION_A, date: '2026-10-15', spotLabel: 'E2.92' }),
        entry({ reservationId: RESERVATION_B, date: '2026-10-16', spotLabel: 'IT-01' }),
      ],
    });

    const events = eventsOf(ics).map((component) => new ICAL.Event(component));
    expect(events.map((event) => event.startDate.toString())).toEqual(['2026-10-15', '2026-10-16']);
    expect(events.map((event) => event.summary)).toEqual([
      'Parkování – E2.92',
      'Parkování – IT-01',
    ]);
    expect(events.map((event) => event.uid)).toEqual([
      icsEventUid(RESERVATION_A),
      icsEventUid(RESERVATION_B),
    ]);
  });

  describe('the day never shifts', () => {
    // A `VALUE=DATE` has no offset, so neither DST nor the server's clock may
    // move it. Both were real risks: see the module header's probe of
    // `ical-generator`'s `timezone` option.
    it.each([
      ['2026-03-29', 'spring forward in Europe/Prague'],
      ['2026-10-25', 'fall back in Europe/Prague'],
      ['2026-01-01', 'a new year'],
      ['2028-02-29', 'a leap day'],
    ])('renders %s unchanged (%s)', (date) => {
      const ics = buildReservationCalendar({ entries: [entry({ date })] });

      expect(onlyEvent(ics).startDate.toString()).toBe(date);
    });

    it('carries nothing whose meaning depends on the server’s clock', () => {
      // The mechanism, asserted in-process. These three properties are exactly
      // what a calendar-level `timezone:` option destroys, and together they
      // are what makes the output zone-independent:
      const ics = buildReservationCalendar({ entries: [entry()] });
      const lines = ics.split('\r\n');

      // 1. No calendar time zone at all.
      expect(lines.some((line) => /^(TIMEZONE-ID|X-WR-TIMEZONE):/.test(line))).toBe(false);
      expect(parseCalendar(ics).getAllSubcomponents('vtimezone')).toHaveLength(0);
      // 2. Every DTSTAMP is absolute UTC (trailing `Z`), never floating.
      const stamps = lines.filter((line) => line.startsWith('DTSTAMP'));
      expect(stamps).not.toHaveLength(0);
      for (const stamp of stamps) {
        expect(stamp).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
      }
      // 3. Every start and end is a date, not a date-time — a `VALUE=DATE`
      //    has no offset to get wrong.
      const bounds = lines.filter((line) => /^DT(START|END)/.test(line));
      expect(bounds).toHaveLength(2);
      for (const bound of bounds) {
        expect(bound).toMatch(/^DT(START|END);VALUE=DATE:\d{8}$/);
      }
    });

    /**
     * The property itself, proved the only way it can be: in a **child
     * process**, one per time zone.
     *
     * Flipping `process.env.TZ` inside the test does not work and — worse —
     * does not fail either. `jest-environment-node` hands each test file a
     * `process` whose `env` is a copy, so the assignment never reaches the real
     * process environment ICU reads; `new Date(...).getHours()` returns the same
     * number under `America/Los_Angeles` and `Europe/Prague`, and an in-process
     * version of this test passes without ever having changed anything. That
     * was observed here, not assumed: the first draft of this test carried a
     * sanity check comparing those two hours, and the sanity check is what
     * failed.
     *
     * `ts-node/register` in transpile-only mode loads the module under test,
     * with `tsconfig-paths/register` beside it because the module has a real
     * runtime import of `@garage/shared-types` (`toUtcMidnight`, `addDays`)
     * that Node cannot resolve on its own. The `@garage/contract` import is
     * `import type` and is erased, so it needs nothing.
     */
    it('produces byte-identical output whatever time zone the server runs in', () => {
      const outputs = TIME_ZONES.map((timeZone) => renderInTimeZone(timeZone));

      // The child really is in the zone it was asked for, so a pass here cannot
      // be a pass over four identical environments.
      expect(outputs.map((result) => result.timeZone)).toEqual(TIME_ZONES);
      expect(new Set(outputs.map((result) => result.localHour)).size).toBeGreaterThan(1);

      expect(new Set(outputs.map((result) => result.ics)).size).toBe(1);
      expect(onlyEvent(outputs[0]?.ics ?? '').startDate.toString()).toBe('2026-10-15');
    }, 60_000);
  });

  it('is a pure function of its input: the same feed months apart is the same bytes', () => {
    // This is what lets Express answer a polling client with 304
    // (`doc/decision/0081-*`).
    //
    // The clock is moved between the two calls, and that is not decoration:
    // `ical-generator` formats `DTSTAMP` to whole seconds, so a naive version
    // of this test — two calls in a row, wall clock — passes even when the
    // builder uses `new Date()`, because both land in the same second. Verified
    // by making that exact change and watching this assertion survive.
    const feed = {
      entries: [entry(), entry({ reservationId: RESERVATION_B, date: '2026-10-16' })],
    };

    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
      const first = buildReservationCalendar(feed);
      jest.setSystemTime(new Date('2027-04-04T04:04:04.000Z'));
      const second = buildReservationCalendar(feed);

      expect(first).toBe(second);
    } finally {
      jest.useRealTimers();
    }
  });

  it('escapes text a naive template would corrupt', () => {
    // RFC 5545 §3.3.11: commas, semicolons, backslashes and newlines are
    // structural inside a TEXT value and have to be escaped. A spot label is
    // administrator-supplied, so this is not hypothetical — and the newline is
    // reachable: `parkingSpotSchema.shape.label` is `z.string().min(1)` with no
    // restriction on it. It is in the fixture because it is the one of the four
    // that a naive template corrupts *structurally* rather than cosmetically —
    // an unescaped newline ends the content line, and everything after it is
    // read as a new iCalendar property.
    const label = 'A,1;B\\C\nSECOND LINE';
    const ics = buildReservationCalendar({ entries: [entry({ spotLabel: label })] });

    const event = onlyEvent(ics);
    expect(event.location).toBe(label);
    expect(event.summary).toBe(icsEventSummary(label));
    expect(event.description).toBe(icsEventDescription(label));
  });

  it('folds long lines so the document stays parseable', () => {
    // RFC 5545 §3.1 caps a content line at 75 octets. Czech diacritics are two
    // octets each, so a long label crosses the limit sooner than its length
    // suggests — and an unfolded over-long line is what makes some clients
    // reject a whole calendar.
    const label = 'Místo číslo ' + 'ěščřžýáíé'.repeat(12);
    const ics = buildReservationCalendar({ entries: [entry({ spotLabel: label })] });

    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    // And it still unfolds back to the original.
    expect(onlyEvent(ics).location).toBe(label);
  });
});
