import {
  PRAGUE_TIME_ZONE,
  endOfDayExclusiveInPrague,
  startOfDayInPrague,
  toDateOnlyInPrague,
  todayInPrague,
} from './prague-time';

/**
 * Every assertion below pins an *instant* (a UTC timestamp), never a local
 * wall-clock value, so the expected results are the same on any machine. The
 * suite additionally re-runs the critical cases under several process time
 * zones: an implementation that reads the machine's local time instead of
 * Europe/Prague would pass in one zone and fail in the others.
 */
const PROCESS_TIME_ZONES = ['UTC', 'Europe/Prague', 'America/Los_Angeles', 'Pacific/Kiritimati'];

/**
 * Runs `assertion` once per entry in {@link PROCESS_TIME_ZONES}.
 *
 * **What this does and does not reach.** Mutating `process.env.TZ` mid-process
 * really does change `Date`'s local methods (`getFullYear`, `getHours`, …) and
 * any `Intl` formatter constructed *after* the assignment — measured in Node 24
 * by the final review, which is why this helper catches an implementation that
 * reads the machine's local time. What it does **not** change is a formatter
 * constructed at *module scope*, before the first assignment ever runs: that
 * object has already resolved its zone.
 *
 * `prague-time.ts:17-26` builds exactly such a module-scope formatter. It is
 * safe here only because it pins `timeZone: PRAGUE_TIME_ZONE` explicitly, so
 * the zone it resolved was never the process's to begin with. Delete that one
 * property and all four iterations below would agree with each other and the
 * suite would stay green while the module was wrong — so the loop is a guard
 * against *reaching for local time*, not a guard against the formatter itself.
 * The 47,847-day sweep that covers the formatter lives in the task report, and
 * `date-only.spec.ts` pins the arithmetic it feeds. Final review M-2.
 */
function underEachProcessTimeZone(assertion: () => void): void {
  const original = process.env['TZ'];
  try {
    for (const timeZone of PROCESS_TIME_ZONES) {
      process.env['TZ'] = timeZone;
      assertion();
    }
  } finally {
    if (original === undefined) {
      delete process.env['TZ'];
    } else {
      process.env['TZ'] = original;
    }
  }
}

describe('PRAGUE_TIME_ZONE', () => {
  it('is the single IANA zone the application operates in', () => {
    expect(PRAGUE_TIME_ZONE).toBe('Europe/Prague');
  });
});

describe('toDateOnlyInPrague', () => {
  it('maps a summer evening instant onto the following Prague day (CEST, UTC+2)', () => {
    underEachProcessTimeZone(() => {
      expect(toDateOnlyInPrague(new Date('2026-08-27T22:30:00Z'))).toBe('2026-08-28');
      expect(toDateOnlyInPrague(new Date('2026-08-27T21:59:59Z'))).toBe('2026-08-27');
    });
  });

  it('maps a winter evening instant onto the following Prague day (CET, UTC+1)', () => {
    underEachProcessTimeZone(() => {
      expect(toDateOnlyInPrague(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
      expect(toDateOnlyInPrague(new Date('2026-01-15T22:59:59Z'))).toBe('2026-01-15');
    });
  });

  it('is stable at Prague midnight on both sides of the DST transitions', () => {
    underEachProcessTimeZone(() => {
      // Spring forward: 2026-03-29 02:00 CET -> 03:00 CEST.
      expect(toDateOnlyInPrague(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
      expect(toDateOnlyInPrague(new Date('2026-03-29T21:59:59Z'))).toBe('2026-03-29');
      expect(toDateOnlyInPrague(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
      // Fall back: 2026-10-25 03:00 CEST -> 02:00 CET.
      expect(toDateOnlyInPrague(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
      expect(toDateOnlyInPrague(new Date('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
      expect(toDateOnlyInPrague(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
    });
  });

  it('crosses the year boundary in Prague an hour before it does in UTC', () => {
    underEachProcessTimeZone(() => {
      expect(toDateOnlyInPrague(new Date('2026-12-31T22:59:59Z'))).toBe('2026-12-31');
      expect(toDateOnlyInPrague(new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01');
    });
  });
});

describe('todayInPrague', () => {
  it('uses the injected instant', () => {
    expect(todayInPrague(new Date('2026-08-27T22:30:00Z'))).toBe('2026-08-28');
  });

  it('falls back to the system clock', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-27T22:30:00Z'));
    try {
      underEachProcessTimeZone(() => {
        expect(todayInPrague()).toBe('2026-08-28');
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('startOfDayInPrague', () => {
  it('resolves winter midnight at UTC+1', () => {
    underEachProcessTimeZone(() => {
      expect(startOfDayInPrague('2026-01-16').toISOString()).toBe('2026-01-15T23:00:00.000Z');
    });
  });

  it('resolves summer midnight at UTC+2', () => {
    underEachProcessTimeZone(() => {
      expect(startOfDayInPrague('2026-08-28').toISOString()).toBe('2026-08-27T22:00:00.000Z');
    });
  });

  it('resolves midnight on the DST transition days themselves', () => {
    underEachProcessTimeZone(() => {
      // The 23-hour day starts while the clock is still on CET.
      expect(startOfDayInPrague('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z');
      expect(startOfDayInPrague('2026-03-30').toISOString()).toBe('2026-03-29T22:00:00.000Z');
      // The 25-hour day starts while the clock is still on CEST.
      expect(startOfDayInPrague('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
      expect(startOfDayInPrague('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z');
    });
  });

  it('round-trips through toDateOnlyInPrague', () => {
    for (const date of ['2026-01-01', '2026-03-29', '2026-06-15', '2026-10-25', '2026-12-31']) {
      expect(toDateOnlyInPrague(startOfDayInPrague(date))).toBe(date);
    }
  });

  it('rejects an invalid date', () => {
    expect(() => startOfDayInPrague('2026-02-30')).toThrow(TypeError);
  });
});

describe('endOfDayExclusiveInPrague', () => {
  it('is the next day midnight, so the two DST days are 23 and 25 hours long', () => {
    const springLength =
      endOfDayExclusiveInPrague('2026-03-29').getTime() -
      startOfDayInPrague('2026-03-29').getTime();
    const autumnLength =
      endOfDayExclusiveInPrague('2026-10-25').getTime() -
      startOfDayInPrague('2026-10-25').getTime();
    const ordinaryLength =
      endOfDayExclusiveInPrague('2026-08-28').getTime() -
      startOfDayInPrague('2026-08-28').getTime();

    expect(springLength).toBe(23 * 3_600_000);
    expect(autumnLength).toBe(25 * 3_600_000);
    expect(ordinaryLength).toBe(24 * 3_600_000);
  });
});
