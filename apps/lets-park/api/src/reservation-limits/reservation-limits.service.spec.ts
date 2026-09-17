/**
 * The settings half of the limits surface, over `PrismaDouble`.
 *
 * Mirrors `../reservation-window/reservation-window.service.spec.ts`: the same
 * double, the same defaults-when-absent case, and the same insistence that the
 * audit entry carries the *values*. "Who lowered the cap, and from what" is not
 * answerable from the row afterwards, so an assertion that `record` was merely
 * called would leave the point of the operation untested.
 *
 * Nothing here covers enforcement. The cap that actually rejects an over-quota
 * insert is read inside the writer's transaction by
 * `readMonthlyReservationCap`, and `../reservations/monthly-reservation-cap.db.spec.ts`
 * covers that against a real PostgreSQL.
 */

import { DEFAULT_MONTHLY_RESERVATION_CAP } from '@lets-park/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaDouble } from '../testing/prisma-double';
import { ReservationLimitsService } from './reservation-limits.service';

describe('ReservationLimitsService', () => {
  let double: PrismaDouble;
  let limits: ReservationLimitsService;

  beforeEach(() => {
    double = new PrismaDouble();
    limits = new ReservationLimitsService(
      double.asPrismaService(),
      new AuditLogService(double.asPrismaService())
    );
  });

  describe('getSettings', () => {
    it('falls back to the documented default when the seed has never run', async () => {
      await expect(limits.getSettings()).resolves.toEqual({
        monthlyReservationCap: DEFAULT_MONTHLY_RESERVATION_CAP,
      });
    });

    it('returns the stored singleton', async () => {
      double.seedLimitSettings({ monthlyReservationCap: 12 });

      await expect(limits.getSettings()).resolves.toEqual({ monthlyReservationCap: 12 });
    });
  });

  describe('monthlyCap', () => {
    it('answers the stored value as a bare number', async () => {
      double.seedLimitSettings({ monthlyReservationCap: 2 });

      await expect(limits.monthlyCap()).resolves.toBe(2);
    });
  });

  describe('updateSettings', () => {
    it('writes the value and returns it', async () => {
      double.seedLimitSettings({ monthlyReservationCap: 5 });

      const result = await limits.updateSettings({ monthlyReservationCap: 8 }, 'admin-1');

      expect(result).toEqual({ monthlyReservationCap: 8 });
      expect(double.limitSettings).toMatchObject({ monthlyReservationCap: 8 });
    });

    it('creates the singleton when it does not exist yet', async () => {
      await limits.updateSettings({ monthlyReservationCap: 3 }, 'admin-1');

      expect(double.limitSettings).toMatchObject({ id: 1, monthlyReservationCap: 3 });
    });

    it('records who changed it, from what, to what', async () => {
      double.seedLimitSettings({ monthlyReservationCap: 5 });

      await limits.updateSettings({ monthlyReservationCap: 2 }, 'admin-1');

      expect(double.auditLogs).toEqual([
        expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'RESERVATION_LIMITS_UPDATED',
          entityType: 'ReservationLimitSettings',
          entityId: '1',
          payload: {
            before: { monthlyReservationCap: 5 },
            after: { monthlyReservationCap: 2 },
          },
        }),
      ]);
    });

    it('records the default as the before value when there was no row', async () => {
      await limits.updateSettings({ monthlyReservationCap: 9 }, 'admin-1');

      expect(double.auditLogs[0]?.payload).toEqual({
        before: { monthlyReservationCap: DEFAULT_MONTHLY_RESERVATION_CAP },
        after: { monthlyReservationCap: 9 },
      });
    });
  });
});
