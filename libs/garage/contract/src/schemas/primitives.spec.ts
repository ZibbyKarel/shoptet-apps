import { dateOnlySchema, idSchema, timestampSchema, yearMonthSchema } from './primitives';

describe('idSchema', () => {
  it('accepts a UUID', () => {
    expect(idSchema.safeParse('6f9619ff-8b86-4d01-b42d-00cf4fc964ff').success).toBe(true);
  });

  it.each(['', 'not-a-uuid', '6f9619ff8b864d01b42d00cf4fc964ff', 42])('rejects %p', (value) => {
    expect(idSchema.safeParse(value).success).toBe(false);
  });
});

describe('dateOnlySchema', () => {
  it.each(['2026-08-28', '2024-02-29', '2026-01-01', '2026-12-31'])('accepts %s', (value) => {
    expect(dateOnlySchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['2023-02-29', 'a 29 February outside a leap year'],
    ['2026-04-31', 'a 31st in a 30-day month'],
    ['2026-13-01', 'a 13th month'],
    ['2026-00-05', 'a zeroth month'],
    ['2026-08-00', 'a zeroth day'],
    ['2026-8-28', 'an unpadded month'],
    ['20260828', 'a date without separators'],
    ['28.8.2026', 'the Czech display format'],
    ['2026-08-28T00:00:00Z', 'a timestamp'],
    ['', 'an empty string'],
  ])('rejects %s (%s)', (value) => {
    expect(dateOnlySchema.safeParse(value).success).toBe(false);
  });

  it.each([undefined, null, 20260828, new Date('2026-08-28')])(
    'rejects the non-string %p',
    (value) => {
      expect(dateOnlySchema.safeParse(value).success).toBe(false);
    }
  );

  describe('validates format only — never the reservation horizon', () => {
    // The horizon depends on ReservationWindowSettings read from the database,
    // which a static schema cannot see; both the "not in the past" check and
    // the window check are service-level (Task 13). See doc/decision/0004.
    it('accepts yesterday, today and tomorrow alike', () => {
      expect(dateOnlySchema.safeParse('2026-08-27').success).toBe(true);
      expect(dateOnlySchema.safeParse('2026-08-28').success).toBe(true);
      expect(dateOnlySchema.safeParse('2026-08-29').success).toBe(true);
    });

    it('accepts dates far in the past and far in the future', () => {
      expect(dateOnlySchema.safeParse('1999-01-01').success).toBe(true);
      expect(dateOnlySchema.safeParse('2099-12-31').success).toBe(true);
    });

    it('accepts a month that is locked or not yet open', () => {
      expect(dateOnlySchema.safeParse('2026-08-01').success).toBe(true); // current month, LOCKED
      expect(dateOnlySchema.safeParse('2027-06-15').success).toBe(true); // NOT_YET_OPEN
    });

    it('accepts the boundaries around a year and a leap day', () => {
      expect(dateOnlySchema.safeParse('2026-12-31').success).toBe(true);
      expect(dateOnlySchema.safeParse('2027-01-01').success).toBe(true);
      expect(dateOnlySchema.safeParse('2028-02-29').success).toBe(true);
    });
  });
});

describe('yearMonthSchema', () => {
  it.each(['2026-01', '2026-12'])('accepts %s', (value) => {
    expect(yearMonthSchema.safeParse(value).success).toBe(true);
  });

  it.each(['2026-13', '2026-00', '2026-1', '2026', '2026-01-01', 202601])('rejects %p', (value) => {
    expect(yearMonthSchema.safeParse(value).success).toBe(false);
  });
});

describe('timestampSchema', () => {
  it('accepts an ISO UTC timestamp', () => {
    expect(timestampSchema.safeParse('2026-08-28T09:15:00.000Z').success).toBe(true);
    expect(timestampSchema.safeParse(new Date().toISOString()).success).toBe(true);
  });

  it.each([
    '2026-08-28T09:15:00+02:00', // offsets are not accepted, only UTC
    '2026-08-28', // a date is not a timestamp
    '2026-08-28 09:15:00',
    '',
  ])('rejects %p', (value) => {
    expect(timestampSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a Date instance — timestamps travel as strings', () => {
    expect(timestampSchema.safeParse(new Date()).success).toBe(false);
  });
});
