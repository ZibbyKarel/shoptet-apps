import { MAX_BULK_BOOKING_DAYS } from '@garage/shared-types';
import {
  bulkBookingInputSchema,
  bulkDayPlanSchema,
  bulkDayResultSchema,
  confirmBulkOutputSchema,
  previewBulkOutputSchema,
} from './bulk';
import { DATE_A, DATE_B, INVALID_DATE, UUID_B } from '../__fixtures__/fixtures';

describe('bulkBookingInputSchema', () => {
  it('accepts a list of days inside one month', () => {
    expect(bulkBookingInputSchema.parse({ dates: [DATE_A, DATE_B] })).toEqual({
      dates: [DATE_A, DATE_B],
    });
  });

  it('accepts an omitted holderId, unchanged from before this field existed', () => {
    const result = bulkBookingInputSchema.safeParse({ dates: [DATE_A, DATE_B] });
    expect(result.success).toBe(true);
    expect(result.success && result.data.holderId).toBeUndefined();
  });

  it('accepts a holderId alongside the dates', () => {
    const result = bulkBookingInputSchema.safeParse({ dates: [DATE_A], holderId: UUID_B });
    expect(result.success).toBe(true);
    expect(result.success && result.data.holderId).toBe(UUID_B);
  });

  it('rejects a holderId that is not a uuid', () => {
    expect(
      bulkBookingInputSchema.safeParse({ dates: [DATE_A], holderId: 'not-a-uuid' }).success
    ).toBe(false);
  });

  it('accepts a single day and a full month', () => {
    expect(bulkBookingInputSchema.safeParse({ dates: [DATE_A] }).success).toBe(true);
    const wholeMonth = Array.from(
      { length: MAX_BULK_BOOKING_DAYS },
      (_unused, index) => `2026-10-${String(index + 1).padStart(2, '0')}`
    );
    expect(bulkBookingInputSchema.safeParse({ dates: wholeMonth }).success).toBe(true);
  });

  it('rejects an empty list', () => {
    expect(bulkBookingInputSchema.safeParse({ dates: [] }).success).toBe(false);
  });

  it('rejects more days than the cap, on the cap and not on the calendar', () => {
    // This test used to build `2026-10-01 … 2026-10-32` and assert only
    // `success === false`. `2026-10-32` is calendar-invalid, so `z.iso.date()`
    // rejected the array on its own: with `.max(MAX_BULK_BOOKING_DAYS)` deleted
    // it still failed, on `invalid_format` at `dates.31`, and nothing anywhere
    // tested the cap. That matters — the cap is the only bound on the array
    // driving the bulk allocator and the `confirmBulk` transaction, and
    // `reservation-window.spec.ts` reasons from a *structural* cap existing.
    //
    // So: 32 days that are every one of them a real date, and an assertion on
    // the reason rather than on the bare boolean. The 32nd falls in November
    // because 31 is all October has — with the cap deleted the same-month
    // refinement would reject it instead, which is why the `too_big` assertion
    // is the load-bearing one.
    const tooMany = [
      ...Array.from(
        { length: MAX_BULK_BOOKING_DAYS },
        (_unused, index) => `2026-10-${String(index + 1).padStart(2, '0')}`
      ),
      '2026-11-01',
    ];
    expect(tooMany).toHaveLength(MAX_BULK_BOOKING_DAYS + 1);

    const result = bulkBookingInputSchema.safeParse({ dates: tooMany });

    expect(result.success).toBe(false);
    const codes = result.error?.issues.map((issue) => issue.code) ?? [];
    expect(codes).toContain('too_big');
    // No day in the list is malformed, so nothing here can be riding on
    // `z.iso.date()` the way the previous version of this test was.
    expect(codes).not.toContain('invalid_format');
  });

  it('rejects duplicates', () => {
    expect(bulkBookingInputSchema.safeParse({ dates: [DATE_A, DATE_A] }).success).toBe(false);
  });

  it('rejects days spread over two months', () => {
    expect(bulkBookingInputSchema.safeParse({ dates: ['2026-09-30', '2026-10-01'] }).success).toBe(
      false
    );
  });

  it('rejects a calendar-invalid day', () => {
    expect(bulkBookingInputSchema.safeParse({ dates: [INVALID_DATE] }).success).toBe(false);
  });

  it('does NOT reject a weekend, a holiday or a past day', () => {
    // Ruling window-2: day eligibility depends on database state and on
    // "today" in Europe/Prague, so it stays in the service layer (Task 30).
    // 2026-09-05 is a Saturday, 2020-01-01 is long past and a public holiday.
    expect(bulkBookingInputSchema.safeParse({ dates: ['2026-09-05'] }).success).toBe(true);
    expect(bulkBookingInputSchema.safeParse({ dates: ['2020-01-01'] }).success).toBe(true);
  });
});

describe('bulkDayPlanSchema', () => {
  const assigned = {
    outcome: 'SPOT_ASSIGNED',
    date: DATE_A,
    parkingSpotId: UUID_B,
    parkingSpotLabel: 'E2.92',
    isPreferredSpot: true,
  };
  const queued = {
    outcome: 'QUEUED',
    date: DATE_A,
    parkingSpotId: UUID_B,
    parkingSpotLabel: 'E2.92',
    waitlistPosition: 3,
  };
  const unavailable = {
    outcome: 'UNAVAILABLE',
    date: DATE_A,
    reason: 'ALREADY_HAS_RESERVATION',
  };

  it.each([
    ['assigned', assigned],
    ['queued', queued],
    ['unavailable', unavailable],
  ])('accepts an %s day', (_label, value) => {
    expect(bulkDayPlanSchema.safeParse(value).success).toBe(true);
  });

  it('rejects an unknown outcome', () => {
    expect(bulkDayPlanSchema.safeParse({ ...assigned, outcome: 'MAYBE' }).success).toBe(false);
  });

  it('rejects an unknown unavailable reason', () => {
    expect(bulkDayPlanSchema.safeParse({ ...unavailable, reason: 'DUNNO' }).success).toBe(false);
  });

  it('rejects a queued day without a position', () => {
    const withoutPosition: Record<string, unknown> = { ...queued };
    delete withoutPosition['waitlistPosition'];
    expect(bulkDayPlanSchema.safeParse(withoutPosition).success).toBe(false);
  });

  it('rejects an assigned day without the preferred-spot flag', () => {
    // Without it a downgrade from the preferred spot would be invisible.
    const withoutFlag: Record<string, unknown> = { ...assigned };
    delete withoutFlag['isPreferredSpot'];
    expect(bulkDayPlanSchema.safeParse(withoutFlag).success).toBe(false);
  });

  it('rejects the plan carrying a reservation id — preview writes nothing', () => {
    const parsed = bulkDayPlanSchema.parse({ ...assigned, reservationId: UUID_B });
    expect(parsed).not.toHaveProperty('reservationId');
  });
});

describe('bulkDayResultSchema', () => {
  it('adds the written row id to each writing outcome', () => {
    expect(
      bulkDayResultSchema.safeParse({
        outcome: 'SPOT_ASSIGNED',
        date: DATE_A,
        parkingSpotId: UUID_B,
        parkingSpotLabel: 'E2.92',
        isPreferredSpot: false,
        reservationId: UUID_B,
      }).success
    ).toBe(true);

    expect(
      bulkDayResultSchema.safeParse({
        outcome: 'QUEUED',
        date: DATE_A,
        parkingSpotId: UUID_B,
        parkingSpotLabel: 'E2.92',
        waitlistPosition: 2,
        waitlistEntryId: UUID_B,
      }).success
    ).toBe(true);
  });

  it('rejects an assigned result without its reservation id', () => {
    expect(
      bulkDayResultSchema.safeParse({
        outcome: 'SPOT_ASSIGNED',
        date: DATE_A,
        parkingSpotId: UUID_B,
        parkingSpotLabel: 'E2.92',
        isPreferredSpot: false,
      }).success
    ).toBe(false);
  });

  it('parses as a plan too, so preview and result zip by date', () => {
    // This is what makes "proposed a spot, ended up queued" legible: both
    // outputs share the discriminant, the date and the descriptive fields.
    const result = {
      outcome: 'QUEUED',
      date: DATE_A,
      parkingSpotId: UUID_B,
      parkingSpotLabel: 'E2.92',
      waitlistPosition: 2,
      waitlistEntryId: UUID_B,
    };
    const asPlan = bulkDayPlanSchema.parse(result);
    expect(asPlan.outcome).toBe('QUEUED');
    expect(asPlan.date).toBe(DATE_A);
  });
});

describe('previewBulkOutputSchema / confirmBulkOutputSchema', () => {
  const summary = { assigned: 1, queued: 0, unavailable: 0, preferredSpotHits: 1 };
  const planDay = {
    outcome: 'SPOT_ASSIGNED',
    date: DATE_A,
    parkingSpotId: UUID_B,
    parkingSpotLabel: 'E2.92',
    isPreferredSpot: true,
  };

  it('accepts a proposal', () => {
    expect(
      previewBulkOutputSchema.safeParse({
        month: '2026-09',
        preferredParkingSpotId: UUID_B,
        days: [planDay],
        summary,
      }).success
    ).toBe(true);
  });

  it('accepts a result whose day was queued although the plan assigned a spot', () => {
    // The exact case the two-step flow exists for: somebody took the spot in
    // between. The result is a valid response, not an error.
    expect(
      confirmBulkOutputSchema.safeParse({
        month: '2026-09',
        preferredParkingSpotId: UUID_B,
        days: [
          {
            outcome: 'QUEUED',
            date: DATE_A,
            parkingSpotId: UUID_B,
            parkingSpotLabel: 'E2.92',
            waitlistPosition: 1,
            waitlistEntryId: UUID_B,
          },
        ],
        summary: { assigned: 0, queued: 1, unavailable: 0, preferredSpotHits: 0 },
      }).success
    ).toBe(true);
  });

  it('accepts a user with no preferred spot', () => {
    expect(
      previewBulkOutputSchema.safeParse({
        month: '2026-09',
        preferredParkingSpotId: null,
        days: [{ ...planDay, isPreferredSpot: false }],
        summary: { ...summary, preferredSpotHits: 0 },
      }).success
    ).toBe(true);
  });

  it('rejects a bad month and a negative summary count', () => {
    expect(
      previewBulkOutputSchema.safeParse({
        month: '2026-13',
        preferredParkingSpotId: null,
        days: [planDay],
        summary,
      }).success
    ).toBe(false);
    expect(
      previewBulkOutputSchema.safeParse({
        month: '2026-09',
        preferredParkingSpotId: null,
        days: [planDay],
        summary: { ...summary, queued: -1 },
      }).success
    ).toBe(false);
  });

  it('rejects a confirm result carrying plan days without ids', () => {
    expect(
      confirmBulkOutputSchema.safeParse({
        month: '2026-09',
        preferredParkingSpotId: UUID_B,
        days: [planDay],
        summary,
      }).success
    ).toBe(false);
  });
});
