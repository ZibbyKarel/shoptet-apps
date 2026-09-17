import { MAX_MONTH_WINDOW_SPAN } from '@garage/shared-types';
import {
  listMonthWindowsInputSchema,
  listMonthWindowsOutputSchema,
  updateReservationWindowSettingsInputSchema,
} from './reservation-window';

describe('updateReservationWindowSettingsInputSchema', () => {
  it('accepts both fields', () => {
    expect(
      updateReservationWindowSettingsInputSchema.parse({
        openDaysBefore: 14,
        lockMode: 'FORCE_LOCKED',
      })
    ).toEqual({ openDaysBefore: 14, lockMode: 'FORCE_LOCKED' });
  });

  it('replaces rather than patches: an omitted field falls back to its default', () => {
    // Documented PUT semantics — the admin form always sends both fields.
    expect(updateReservationWindowSettingsInputSchema.parse({ openDaysBefore: 3 })).toEqual({
      openDaysBefore: 3,
      lockMode: 'AUTO',
    });
  });

  it('rejects out-of-range openDaysBefore and an unknown lock mode', () => {
    expect(
      updateReservationWindowSettingsInputSchema.safeParse({ openDaysBefore: 0 }).success
    ).toBe(false);
    expect(
      updateReservationWindowSettingsInputSchema.safeParse({ openDaysBefore: 32 }).success
    ).toBe(false);
    expect(
      updateReservationWindowSettingsInputSchema.safeParse({ lockMode: 'FORCE_MAYBE' }).success
    ).toBe(false);
  });
});

describe('listMonthWindowsInputSchema', () => {
  it('accepts an ascending range and a single month', () => {
    expect(listMonthWindowsInputSchema.parse({ from: '2026-09', to: '2026-12' })).toEqual({
      from: '2026-09',
      to: '2026-12',
    });
    expect(listMonthWindowsInputSchema.safeParse({ from: '2026-09', to: '2026-09' }).success).toBe(
      true
    );
  });

  it('rejects a reversed range', () => {
    expect(listMonthWindowsInputSchema.safeParse({ from: '2026-12', to: '2026-09' }).success).toBe(
      false
    );
  });

  it('rejects a malformed month', () => {
    expect(listMonthWindowsInputSchema.safeParse({ from: '2026-13', to: '2026-14' }).success).toBe(
      false
    );
    expect(
      listMonthWindowsInputSchema.safeParse({ from: '2026-09-01', to: '2026-12-01' }).success
    ).toBe(false);
  });

  // The span cap is structural so the client knows the limit from the schema
  // instead of discovering it by being rejected at runtime; that is why the
  // procedure declares no VALIDATION_FAILED (doc/decision/0021-*).
  it('accepts a range exactly MAX_MONTH_WINDOW_SPAN months long', () => {
    // 2026-01 .. 2027-12 is 24 months counting both endpoints.
    expect(MAX_MONTH_WINDOW_SPAN).toBe(24);
    expect(listMonthWindowsInputSchema.safeParse({ from: '2026-01', to: '2027-12' }).success).toBe(
      true
    );
  });

  it('rejects a range one month longer than the cap', () => {
    expect(listMonthWindowsInputSchema.safeParse({ from: '2026-01', to: '2028-01' }).success).toBe(
      false
    );
  });

  it('counts the span across a year boundary, not lexicographically', () => {
    // 2026-12 .. 2027-01 is two months, not thirteen.
    expect(listMonthWindowsInputSchema.safeParse({ from: '2026-12', to: '2027-01' }).success).toBe(
      true
    );
  });
});

describe('listMonthWindowsOutputSchema', () => {
  const settings = { openDaysBefore: 7, lockMode: 'AUTO' };
  const month = {
    month: '2026-09',
    windowFrom: '2026-08-25',
    windowTo: '2026-08-31',
    state: 'OPEN',
    lockMode: 'AUTO',
  };

  it('returns the months together with the settings they were derived under', () => {
    expect(listMonthWindowsOutputSchema.parse({ months: [month], settings })).toEqual({
      months: [month],
      settings,
    });
  });

  it('reports an overridden month as overridden', () => {
    const parsed = listMonthWindowsOutputSchema.parse({
      months: [{ ...month, state: 'LOCKED', lockMode: 'FORCE_LOCKED' }],
      settings: { openDaysBefore: 7, lockMode: 'FORCE_LOCKED' },
    });
    expect(parsed.months[0]?.lockMode).toBe('FORCE_LOCKED');
  });

  it('rejects a month entry without its lock mode', () => {
    const withoutLockMode: Record<string, unknown> = { ...month };
    delete withoutLockMode['lockMode'];
    expect(
      listMonthWindowsOutputSchema.safeParse({ months: [withoutLockMode], settings }).success
    ).toBe(false);
  });
});
