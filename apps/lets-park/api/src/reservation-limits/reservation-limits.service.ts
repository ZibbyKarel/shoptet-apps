/**
 * The reservation limits: the singleton settings, read and replaced.
 *
 * Mirrors `ReservationWindowService`'s settings half exactly, including why the
 * row is upserted rather than required: a deployment whose seed has not run
 * would otherwise answer with a 500, and the honest value for "no row yet" is
 * the documented default, which is what the row would have contained.
 *
 * **This service is not in the enforcement path.** The cap that actually
 * rejects an over-quota insert is loaded by `readMonthlyReservationCap` inside
 * the writer's own transaction (`../reservations/monthly-reservation-cap.ts`);
 * this class serves the admin screen and the month summary, both of which are
 * plain reads outside any transaction.
 */

import { Injectable } from '@nestjs/common';
import type { ReservationLimitSettings } from '@lets-park/contract';
import { RESERVATION_LIMIT_SETTINGS_ID } from '@lets-park/database';
import { DEFAULT_MONTHLY_RESERVATION_CAP } from '@lets-park/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import { toContractLimitSettings } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ReservationLimitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService
  ) {}

  /** The current settings, defaulted if the singleton has never been written. */
  async getSettings(): Promise<ReservationLimitSettings> {
    const row = await this.prisma.client.reservationLimitSettings.findUnique({
      where: { id: RESERVATION_LIMIT_SETTINGS_ID },
    });

    return row === null
      ? { monthlyReservationCap: DEFAULT_MONTHLY_RESERVATION_CAP }
      : toContractLimitSettings(row);
  }

  /**
   * Just the cap, for the month summary.
   *
   * A convenience over {@link getSettings} rather than a second read path, so
   * the defaulting rule stays in one place — and deliberately not a call to
   * `readMonthlyReservationCap(this.prisma.client)`, which takes a
   * `Prisma.TransactionClient` that a `PrismaClient` structurally satisfies but
   * which would read as though a transaction were involved when none is.
   */
  async monthlyCap(): Promise<number> {
    return (await this.getSettings()).monthlyReservationCap;
  }

  /**
   * Replaces the settings and records the change.
   *
   * A **replacement**, not a patch — the contract's input is the settings schema
   * itself, so an omitted field has already been filled in with its default by
   * the time it reaches here.
   *
   * The audit entry is the point of the operation as much as the write is: this
   * field decides how much every user in the company may book, and "who lowered
   * the cap, from what, and when" is not answerable from the row afterwards.
   */
  async updateSettings(
    input: ReservationLimitSettings,
    actorUserId: string
  ): Promise<ReservationLimitSettings> {
    const before = await this.getSettings();

    const row = await this.prisma.client.reservationLimitSettings.upsert({
      where: { id: RESERVATION_LIMIT_SETTINGS_ID },
      create: {
        id: RESERVATION_LIMIT_SETTINGS_ID,
        monthlyReservationCap: input.monthlyReservationCap,
      },
      update: { monthlyReservationCap: input.monthlyReservationCap },
    });
    const after = toContractLimitSettings(row);

    // The `payload` shape is fixed per action by `../audit/audit-payloads.ts`.
    await this.audit.record({
      actorUserId,
      action: 'RESERVATION_LIMITS_UPDATED',
      entityType: 'ReservationLimitSettings',
      entityId: String(RESERVATION_LIMIT_SETTINGS_ID),
      payload: {
        before: { monthlyReservationCap: before.monthlyReservationCap },
        after: { monthlyReservationCap: after.monthlyReservationCap },
      },
    });

    return after;
  }
}
