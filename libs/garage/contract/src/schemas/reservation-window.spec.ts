import { monthLockState, reservationWindowRange } from '@garage/shared-types';
import { monthWindowOverviewSchema, reservationWindowSettingsSchema } from './reservation-window';

describe('reservationWindowSettingsSchema', () => {
  it('fills in the defaults from doc/decision/0004', () => {
    expect(reservationWindowSettingsSchema.parse({})).toEqual({
      openDaysBefore: 7,
      lockMode: 'AUTO',
    });
  });

  it('accepts explicit values', () => {
    expect(
      reservationWindowSettingsSchema.parse({ openDaysBefore: 14, lockMode: 'FORCE_OPEN' })
    ).toEqual({ openDaysBefore: 14, lockMode: 'FORCE_OPEN' });
  });

  it('accepts the inclusive bounds of openDaysBefore', () => {
    expect(reservationWindowSettingsSchema.safeParse({ openDaysBefore: 1 }).success).toBe(true);
    expect(reservationWindowSettingsSchema.safeParse({ openDaysBefore: 31 }).success).toBe(true);
  });

  it.each([0, -1, 32, 7.5, Number.NaN, '7', null])('rejects openDaysBefore %p', (value) => {
    expect(reservationWindowSettingsSchema.safeParse({ openDaysBefore: value }).success).toBe(
      false
    );
  });

  it('rejects an unknown lock mode', () => {
    expect(reservationWindowSettingsSchema.safeParse({ lockMode: 'FORCE_MAYBE' }).success).toBe(
      false
    );
  });
});

describe('monthWindowOverviewSchema', () => {
  const valid = {
    month: '2026-09',
    windowFrom: '2026-08-25',
    windowTo: '2026-08-31',
    state: 'OPEN',
    lockMode: 'AUTO',
  };

  it('accepts a valid overview', () => {
    expect(monthWindowOverviewSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['month', '2026-13'],
    ['month', '2026-09-01'],
    ['windowFrom', '2026-02-30'],
    ['windowTo', ''],
    ['state', 'CLOSED'],
    ['lockMode', 'FORCE_MAYBE'],
  ])('rejects an invalid %s (%p)', (field, value) => {
    expect(monthWindowOverviewSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it('requires lockMode — a FORCE_LOCKED month must not look AUTO-derived', () => {
    // Regression guard for the Task 3 review finding S2: without lockMode the
    // UI could render "opens 25 Aug" for a month the admin has force-locked.
    const withoutLockMode: Record<string, unknown> = { ...valid };
    delete withoutLockMode['lockMode'];
    expect(monthWindowOverviewSchema.safeParse(withoutLockMode).success).toBe(false);
  });

  it('reports the AUTO range next to the overriding mode under FORCE_LOCKED', () => {
    const parsed = monthWindowOverviewSchema.parse({
      ...valid,
      state: 'LOCKED',
      lockMode: 'FORCE_LOCKED',
    });
    // Both facts survive: the range the AUTO rule *would* have produced, and
    // the fact that an admin overrode it.
    expect(parsed.windowFrom).toBe('2026-08-25');
    expect(parsed.lockMode).toBe('FORCE_LOCKED');
    expect(parsed.state).toBe('LOCKED');
  });

  it('carries exactly what the shared-types window functions produce', () => {
    // The overview is assembled by the service layer from monthLockState() and
    // reservationWindowRange(); the schema must accept that output verbatim.
    const today = '2026-08-28';
    const target = '2026-09-15';
    const { from, to } = reservationWindowRange(target, 7);
    const parsed = monthWindowOverviewSchema.parse({
      month: '2026-09',
      windowFrom: from,
      windowTo: to,
      state: monthLockState(target, 7, 'AUTO', today),
      lockMode: 'AUTO',
    });
    expect(parsed).toEqual({
      month: '2026-09',
      windowFrom: '2026-08-25',
      windowTo: '2026-08-31',
      state: 'OPEN',
      lockMode: 'AUTO',
    });
  });
});
