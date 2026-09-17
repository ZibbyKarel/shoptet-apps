/**
 * The reservation window: the singleton settings, and where each month stands.
 *
 * **Nothing in this file decides whether a month is open.** That is
 * `monthLockState()` / `isMonthOpen()` in `@garage/shared-types` (Task 3),
 * which transcribe the `monthOpen` function from the approved design and are
 * covered by their own tests. This service loads the settings, asks today's date
 * in Europe/Prague, calls those functions, and shapes the answer for the
 * contract. Re-deriving the rule here — even "just the easy case" — is how the
 * banner and the backend start disagreeing about the same day.
 *
 * ## Why the settings row is upserted rather than required
 *
 * `ReservationWindowSettings` is a singleton with a fixed id and a
 * `CHECK ("id" = 1)` constraint (`doc/decision/0026-*`), created by the seed. A
 * deployment whose seed has not run would otherwise answer `admin.window.get`
 * with a 500 — and the honest value for "no row yet" is not an error, it is the
 * documented defaults, which is exactly what the row would have contained.
 */

import { Injectable } from '@nestjs/common';
import type {
  ListMonthWindowsInput,
  ListMonthWindowsOutput,
  MonthWindowOverview,
  ReservationWindowSettings,
} from '@garage/contract';
import { RESERVATION_WINDOW_SETTINGS_ID } from '@garage/database';
import type { DateOnly, YearMonth } from '@garage/shared-types';
import {
  DEFAULT_OPEN_DAYS_BEFORE,
  DEFAULT_RESERVATION_LOCK_MODE,
  addMonths,
  monthLockState,
  reservationWindowRange,
  startOfYearMonth,
  todayInPrague,
  toYearMonth,
} from '@garage/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import { toContractWindowSettings } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ReservationWindowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService
  ) {}

  /** The current settings, defaulted if the singleton has never been written. */
  async getSettings(): Promise<ReservationWindowSettings> {
    const row = await this.prisma.client.reservationWindowSettings.findUnique({
      where: { id: RESERVATION_WINDOW_SETTINGS_ID },
    });

    return row === null
      ? { openDaysBefore: DEFAULT_OPEN_DAYS_BEFORE, lockMode: DEFAULT_RESERVATION_LOCK_MODE }
      : toContractWindowSettings(row);
  }

  /**
   * Replaces the settings and records the change.
   *
   * A **replacement**, not a patch — the contract's input is the settings schema
   * itself, so an omitted field has already been filled in with its default by
   * the time it reaches here (`doc/contract.md` §"Reservation window").
   *
   * The audit entry is the point of the operation as much as the write is: these
   * two fields decide, for every user, whether a month can be booked at all, and
   * "who closed December and when" is not answerable from the row afterwards.
   */
  async updateSettings(
    input: ReservationWindowSettings,
    actorUserId: string
  ): Promise<ReservationWindowSettings> {
    const before = await this.getSettings();

    const row = await this.prisma.client.reservationWindowSettings.upsert({
      where: { id: RESERVATION_WINDOW_SETTINGS_ID },
      create: {
        id: RESERVATION_WINDOW_SETTINGS_ID,
        openDaysBefore: input.openDaysBefore,
        lockMode: input.lockMode,
      },
      update: { openDaysBefore: input.openDaysBefore, lockMode: input.lockMode },
    });
    const after = toContractWindowSettings(row);

    // The `payload` shape is fixed per action by `../audit/audit-payloads.ts`.
    await this.audit.record({
      actorUserId,
      action: 'RESERVATION_WINDOW_UPDATED',
      entityType: 'ReservationWindowSettings',
      entityId: String(RESERVATION_WINDOW_SETTINGS_ID),
      payload: {
        before: { openDaysBefore: before.openDaysBefore, lockMode: before.lockMode },
        after: { openDaysBefore: after.openDaysBefore, lockMode: after.lockMode },
      },
    });

    return after;
  }

  /**
   * One row per month in the inclusive range, ascending, plus the settings they
   * were derived under — so the admin tab renders the table and the form from a
   * single response.
   *
   * The range is bounded by `MAX_MONTH_WINDOW_SPAN` in the contract's schema, so
   * the loop below cannot run away.
   */
  async listMonths(
    input: ListMonthWindowsInput,
    today = todayInPrague()
  ): Promise<ListMonthWindowsOutput> {
    const settings = await this.getSettings();
    const months: MonthWindowOverview[] = [];

    for (let month = input.from; month <= input.to; month = nextMonth(month)) {
      months.push(this.describeMonth(month, settings, today));
    }

    return { months, settings };
  }

  /**
   * The window state of the month a given **day** falls in. What the day
   * overview embeds in its payload.
   */
  describeDay(
    date: DateOnly,
    settings: ReservationWindowSettings,
    today: DateOnly
  ): MonthWindowOverview {
    return this.describeMonth(toYearMonth(date), settings, today);
  }

  private describeMonth(
    month: YearMonth,
    settings: ReservationWindowSettings,
    today: DateOnly
  ): MonthWindowOverview {
    const firstOfMonth = startOfYearMonth(month);
    const { from, to } = reservationWindowRange(firstOfMonth, settings.openDaysBefore);

    return {
      month,
      // Always the range the AUTO rule would produce, even when `lockMode`
      // overrides the state — the UI needs it to explain what the automatic rule
      // would have done, and reads `lockMode` to know whether it applies.
      windowFrom: from,
      windowTo: to,
      state: monthLockState(firstOfMonth, settings.openDaysBefore, settings.lockMode, today),
      lockMode: settings.lockMode,
    };
  }
}

/** `2026-12` -> `2027-01`. Goes through the day helpers rather than by hand. */
function nextMonth(month: YearMonth): YearMonth {
  return toYearMonth(addMonths(startOfYearMonth(month), 1));
}
