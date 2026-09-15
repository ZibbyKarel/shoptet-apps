import {
  BULK_DAY_OUTCOMES,
  BULK_UNAVAILABLE_REASONS,
  CELL_LOCK_RESULTS,
  DEFAULT_OPEN_DAYS_BEFORE,
  DEFAULT_RESERVATION_LOCK_MODE,
  MAX_BULK_BOOKING_DAYS,
  MAX_MONTH_WINDOW_SPAN,
  MAX_OPEN_DAYS_BEFORE,
  MIN_OPEN_DAYS_BEFORE,
  MONTHLY_RESERVATION_CAP,
  MONTH_LOCK_STATES,
  PARKING_GROUPS,
  RESERVATION_LOCK_MODES,
  RESERVATION_REASSIGN_CAUSES,
  USER_ROLES,
} from './domain-constants';

describe('domain enumerations', () => {
  it('lists the parking groups', () => {
    expect(PARKING_GROUPS).toEqual(['IT', 'SHARED']);
  });

  it('lists the user roles', () => {
    expect(USER_ROLES).toEqual(['USER', 'ADMIN']);
  });

  it('lists the reservation lock modes', () => {
    expect(RESERVATION_LOCK_MODES).toEqual(['AUTO', 'FORCE_OPEN', 'FORCE_LOCKED']);
  });

  it('lists the month lock states', () => {
    expect(MONTH_LOCK_STATES).toEqual(['NOT_YET_OPEN', 'OPEN', 'LOCKED']);
  });
});

/**
 * The two enumerations this file used to skip — and the pair with the most
 * domain reasoning attached to them, since they are what the bulk allocator
 * reports per day and what the UI lays the preview and the result out against.
 * Final review M-3.
 */
describe('bulk booking enumerations', () => {
  it('lists what can become of one selected day', () => {
    expect(BULK_DAY_OUTCOMES).toEqual(['SPOT_ASSIGNED', 'QUEUED', 'UNAVAILABLE']);
  });

  it('lists why a day produced neither a reservation nor a queue position', () => {
    // Per-day facts inside a *successful* response: one impossible day must not
    // throw away the rest of the batch. Conditions that invalidate the whole
    // request (locked month, day in the past) are contract errors instead, so
    // they must never appear here.
    expect(BULK_UNAVAILABLE_REASONS).toEqual([
      'ALREADY_HAS_RESERVATION',
      'NOT_A_BUSINESS_DAY',
      'NO_SPOTS_AVAILABLE',
    ]);
  });

  it('reasons exist only for the UNAVAILABLE outcome', () => {
    expect(BULK_DAY_OUTCOMES).toContain('UNAVAILABLE');
    for (const reason of BULK_UNAVAILABLE_REASONS) {
      expect(BULK_DAY_OUTCOMES).not.toContain(reason);
    }
  });
});

describe('reservation window defaults', () => {
  it('matches doc/decision/0004', () => {
    expect(DEFAULT_OPEN_DAYS_BEFORE).toBe(7);
    expect(DEFAULT_RESERVATION_LOCK_MODE).toBe('AUTO');
    expect(MIN_OPEN_DAYS_BEFORE).toBe(1);
    expect(MAX_OPEN_DAYS_BEFORE).toBe(31);
  });

  it('keeps the default inside the accepted bounds', () => {
    expect(DEFAULT_OPEN_DAYS_BEFORE).toBeGreaterThanOrEqual(MIN_OPEN_DAYS_BEFORE);
    expect(DEFAULT_OPEN_DAYS_BEFORE).toBeLessThanOrEqual(MAX_OPEN_DAYS_BEFORE);
  });
});

describe('realtime enumerations', () => {
  it('has exactly one reassignment cause, because only one thing emits one', () => {
    // An `ADMIN_REASSIGNMENT` member would be a cause nothing can produce: the
    // API contract has no procedure that moves a reservation between users.
    // See doc/decision/0021-* and doc/decision/0022-*.
    expect(RESERVATION_REASSIGN_CAUSES).toEqual(['WAITLIST_PROMOTION']);
  });

  it('lists both outcomes of a cell-lock request', () => {
    expect(CELL_LOCK_RESULTS).toEqual(['ACQUIRED', 'HELD_BY_OTHER']);
  });
});

describe('structural caps', () => {
  it('caps a month-window range at two years', () => {
    expect(MAX_MONTH_WINDOW_SPAN).toBe(24);
  });

  it('caps a bulk booking at a calendar month', () => {
    expect(MAX_BULK_BOOKING_DAYS).toBe(31);
  });

  it('caps a calendar month at 5 confirmed reservations', () => {
    expect(MONTHLY_RESERVATION_CAP).toBe(5);
  });

  it('states all caps as positive integers the contract can enforce structurally', () => {
    // All exist so the limit lives in the schema instead of being discovered
    // by rejection (doc/decision/0021-*).
    for (const cap of [MAX_MONTH_WINDOW_SPAN, MAX_BULK_BOOKING_DAYS, MONTHLY_RESERVATION_CAP]) {
      expect(Number.isInteger(cap) && cap > 0).toBe(true);
    }
  });
});
