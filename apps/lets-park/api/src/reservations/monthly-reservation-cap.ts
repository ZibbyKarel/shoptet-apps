/**
 * The per-user, per-calendar-month cap on confirmed reservations.
 *
 * A request-time computation, not stored state: no new column, no migration.
 * Every path that inserts a `Reservation` row for a real user (never a guest —
 * a guest has no `userId`, so no budget applies) calls
 * `assertWithinMonthlyReservationCap` as the very last check before the
 * insert, inside the same transaction that will do the insert.
 *
 * The `pg_advisory_xact_lock` this takes is a new lock resource, but it is not
 * a disjoint one, and an earlier version of this comment claiming it could not
 * form a new cycle was wrong. Two holders go on to want row locks in the same
 * transaction: `WaitlistPromotionService.promote` takes it once per skipped
 * over-cap candidate while already holding a queue row `FOR UPDATE`, and
 * `BulkReservationService.confirmOnce` takes it and then has
 * `releaseOwnQueues` `DELETE` the caller's `WaitlistEntry` rows, which can
 * block on a queue row a concurrent `cancel` + `promote` holds `FOR UPDATE`
 * while that transaction blocks here. That is a real cycle, and PostgreSQL
 * resolves it by killing one side with `40P01`.
 *
 * The mitigation is a retry, not an ordering — no ordering is available,
 * because the key is month-scoped and the row locks are date-scoped:
 * `BulkReservationService.committedConfirm` re-runs the transaction on any
 * `isWriteConflict` and reports `CONFLICT` when the attempts run out, exactly
 * as `ReservationsService.cancel` does for the cycle in
 * `doc/decision/0065-*`. `doc/decision/0307-*` has the full analysis.
 *
 * Unlike the per-day rule (a real unique index, so an optimistic pre-check is
 * safe and `P2002` is the final arbiter), there is no constraint that could
 * reject an over-cap insert — the lock + recount inside it *is* the
 * authoritative check.
 */

import type { Prisma } from '@lets-park/database';
import {
  endOfMonth,
  DEFAULT_MONTHLY_RESERVATION_CAP,
  startOfMonth,
  toYearMonth,
  type DateOnly,
} from '@lets-park/shared-types';
import { toDateColumn } from '../common/prisma-mapping';
import { DomainError } from '../common/errors/domain-error';

export { DEFAULT_MONTHLY_RESERVATION_CAP };

/**
 * Throws `DomainError('MONTHLY_RESERVATION_LIMIT_REACHED')` if `userId` already
 * holds `DEFAULT_MONTHLY_RESERVATION_CAP - additional` or more confirmed reservations
 * in `date`'s calendar month. `additional` is how many more the caller is
 * about to insert in this same transaction (default 1; bulk confirm passes the
 * count of days it is about to assign).
 */
export async function assertWithinMonthlyReservationCap(
  tx: Prisma.TransactionClient,
  userId: string,
  date: DateOnly,
  additional = 1
): Promise<void> {
  const month = toYearMonth(date);
  await lockUserMonth(tx, userId, month);

  const count = await tx.reservation.count({
    where: {
      userId,
      date: { gte: toDateColumn(startOfMonth(date)), lte: toDateColumn(endOfMonth(date)) },
    },
  });

  if (count + additional > DEFAULT_MONTHLY_RESERVATION_CAP) {
    throw new DomainError('MONTHLY_RESERVATION_LIMIT_REACHED', {
      details: { month, limit: DEFAULT_MONTHLY_RESERVATION_CAP },
    });
  }
}

/**
 * `hashtextextended` rather than `hashtext`: `pg_advisory_xact_lock` takes a
 * `bigint`, and `hashtext` only returns `int4`. The seed argument (`0`) is
 * fixed — it only has to be consistent between calls, not secret.
 *
 * `$executeRaw` rather than `$queryRaw`: `pg_advisory_xact_lock` returns
 * `void`, and Prisma's raw-result deserializer rejects that column type
 * (`Failed to deserialize column of type 'void'`). `$executeRaw` still runs the
 * statement and still blocks until the lock is acquired — it just does not try
 * to read a result set back — and `monthly-reservation-cap.db.spec.ts`
 * (`serializes two callers …`) asserts against a real PostgreSQL that a second
 * transaction really does block on it, not merely that this compiles.
 */
async function lockUserMonth(
  tx: Prisma.TransactionClient,
  userId: string,
  month: string
): Promise<void> {
  const key = `${userId}:${month}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
