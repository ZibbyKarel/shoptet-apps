import {
  ICS_FEED_BASE_PATH,
  ICS_FEED_FILE_EXTENSION,
  buildIcsFeedPath,
  buildIcsFeedUrl,
  icsCalendarEntrySchema,
  icsFeedSchema,
} from './ics';

describe('buildIcsFeedPath', () => {
  it('builds /api/calendar/<token>.ics', () => {
    expect(buildIcsFeedPath('s3cr3t-token')).toBe('/api/calendar/s3cr3t-token.ics');
  });

  it('is built from the exported constants, not a repeated literal', () => {
    const token = 'abc';
    expect(buildIcsFeedPath(token)).toBe(
      `${ICS_FEED_BASE_PATH}/${token}${ICS_FEED_FILE_EXTENSION}`
    );
  });

  it('includes the API global prefix', () => {
    // apps/garage/api/src/main.ts calls app.setGlobalPrefix('api'); if that ever
    // changes, this constant has to change with it.
    expect(ICS_FEED_BASE_PATH.startsWith('/api/')).toBe(true);
  });

  it('percent-encodes the token', () => {
    expect(buildIcsFeedPath('a/b c')).toBe('/api/calendar/a%2Fb%20c.ics');
  });

  it('rejects an empty token instead of returning a collection URL', () => {
    expect(() => buildIcsFeedPath('')).toThrow(/must not be empty/);
  });
});

describe('buildIcsFeedUrl', () => {
  it('joins an origin with the feed path', () => {
    expect(buildIcsFeedUrl('https://parking.example.com', 'tok')).toBe(
      'https://parking.example.com/api/calendar/tok.ics'
    );
  });

  it('normalizes trailing slashes on the base URL', () => {
    expect(buildIcsFeedUrl('https://parking.example.com/', 'tok')).toBe(
      buildIcsFeedUrl('https://parking.example.com', 'tok')
    );
    expect(buildIcsFeedUrl('https://parking.example.com///', 'tok')).toBe(
      'https://parking.example.com/api/calendar/tok.ics'
    );
  });

  it('produces a URL a calendar client can parse', () => {
    const url = new URL(buildIcsFeedUrl('http://localhost:3000', 'tok'));
    expect(url.origin).toBe('http://localhost:3000');
    expect(url.pathname).toBe('/api/calendar/tok.ics');
  });

  it('rejects an empty base URL or an empty token', () => {
    expect(() => buildIcsFeedUrl('', 'tok')).toThrow(/must not be empty/);
    expect(() => buildIcsFeedUrl('https://example.com', '')).toThrow(/must not be empty/);
  });
});

describe('icsCalendarEntrySchema', () => {
  const valid = {
    reservationId: '0199c0f0-3a1a-7000-8000-000000000001',
    date: '2026-10-15',
    createdAt: '2026-09-01T08:30:00.000Z',
    spotLabel: 'E2.92',
  };

  it('accepts a reservation as it enters the calendar', () => {
    expect(icsCalendarEntrySchema.parse(valid)).toEqual(valid);
  });

  it('is built from the entity schemas, not from restated field rules', () => {
    // The date rule is `reservationSchema`'s, so a non-calendar day is rejected
    // here for free. If someone replaces the pick with a hand-written
    // `z.string()`, this fails.
    expect(icsCalendarEntrySchema.safeParse({ ...valid, date: '2026-02-30' }).success).toBe(false);
    expect(icsCalendarEntrySchema.safeParse({ ...valid, date: '15.10.2026' }).success).toBe(false);
    expect(
      icsCalendarEntrySchema.safeParse({ ...valid, reservationId: 'not-a-uuid' }).success
    ).toBe(false);
    expect(icsCalendarEntrySchema.safeParse({ ...valid, spotLabel: '' }).success).toBe(false);
    expect(icsCalendarEntrySchema.safeParse({ ...valid, createdAt: '2026-09-01' }).success).toBe(
      false
    );
  });

  it('carries no user id and no spot id', () => {
    // Both would let a feed be built for the wrong person, or claim to
    // identify a spot an ICS file cannot link to. Asserted on the schema's
    // own key set so adding one is a failing test, not a review miss.
    expect(Object.keys(icsCalendarEntrySchema.shape).sort()).toEqual([
      'createdAt',
      'date',
      'reservationId',
      'spotLabel',
    ]);
  });
});

describe('icsFeedSchema', () => {
  it('accepts an empty feed', () => {
    expect(icsFeedSchema.parse({ entries: [] })).toEqual({ entries: [] });
  });

  it('validates every entry', () => {
    expect(icsFeedSchema.safeParse({ entries: [{ date: '2026-10-15' }] }).success).toBe(false);
  });
});
