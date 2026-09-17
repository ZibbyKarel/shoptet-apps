/**
 * The monthly-cap helper against a real PostgreSQL 17.
 *
 * Run with `nx run api:test-db` after `docker compose --profile dev up -d`.
 */
import type { PrismaClient } from '@lets-park/database';
import { addDays, isBusinessDay, toYearMonth, type DateOnly } from '@lets-park/shared-types';
import { toDateColumn } from '../common/prisma-mapping';
import {
  FUTURE_BUSINESS_DAY,
  codeOf,
  connect,
  holdTransaction,
  seedSpot,
  seedUser,
  waitForBlockedBackend,
} from '../testing/database/reservation-harness';
import {
  DEFAULT_MONTHLY_RESERVATION_CAP,
  assertWithinMonthlyReservationCap,
} from './monthly-reservation-cap';

/**
 * `count` business days in the same calendar month as `FUTURE_BUSINESS_DAY`,
 * starting from it.
 *
 * Typed as a non-empty tuple — every caller passes a `count >= 1` and asks for
 * the first date — so indexing `[0]` type-checks under `noUncheckedIndexedAccess`
 * without a non-null assertion, which this project's lint config forbids.
 */
function businessDaysInMonth(count: number): [DateOnly, ...DateOnly[]] {
  if (count < 1) {
    throw new Error('count must be at least 1');
  }
  const month = FUTURE_BUSINESS_DAY.slice(0, 7);
  const dates: DateOnly[] = [];
  let cursor = FUTURE_BUSINESS_DAY;
  while (dates.length < count) {
    if (cursor.slice(0, 7) !== month) {
      throw new Error(
        `ran out of business days in ${month} — widen the search or pick a later start`
      );
    }
    if (isBusinessDay(cursor)) {
      dates.push(cursor);
    }
    cursor = addDays(cursor, 1);
  }
  return dates as [DateOnly, ...DateOnly[]];
}

/**
 * `arr[index]`, but typed as `T` rather than `T | undefined`.
 *
 * A plain runtime guard rather than a non-null assertion: this project's lint
 * config forbids `!` (`@typescript-eslint/no-non-null-assertion`), and this is
 * the one place below that needs an index past position `0`, which
 * `businessDaysInMonth`'s tuple return does not cover.
 */
function nth<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`index ${index} out of range for an array of length ${arr.length}`);
  }
  return value;
}

describe('assertWithinMonthlyReservationCap against a real PostgreSQL', () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = connect();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it('passes when the user is under the cap for the month', async () => {
    const user = await seedUser(client);
    const spot = await seedSpot(client);
    const dates = businessDaysInMonth(DEFAULT_MONTHLY_RESERVATION_CAP - 1);
    for (const date of dates) {
      await client.reservation.create({
        data: { parkingSpotId: spot.id, userId: user.id, date: toDateColumn(date) },
      });
    }

    await expect(
      client.$transaction((tx) => assertWithinMonthlyReservationCap(tx, user.id, dates[0]))
    ).resolves.toBeUndefined();
  });

  it('rejects with MONTHLY_RESERVATION_LIMIT_REACHED once the cap would be exceeded', async () => {
    const user = await seedUser(client);
    const spot = await seedSpot(client);
    const dates = businessDaysInMonth(DEFAULT_MONTHLY_RESERVATION_CAP);
    for (const date of dates) {
      await client.reservation.create({
        data: { parkingSpotId: spot.id, userId: user.id, date: toDateColumn(date) },
      });
    }

    const code = await codeOf(
      client.$transaction((tx) => assertWithinMonthlyReservationCap(tx, user.id, dates[0]))
    );
    expect(code).toBe('MONTHLY_RESERVATION_LIMIT_REACHED');
  });

  it("does not count another user's reservations toward this user's cap", async () => {
    const [userA, userB] = [await seedUser(client), await seedUser(client)];
    const spot = await seedSpot(client);
    const dates = businessDaysInMonth(DEFAULT_MONTHLY_RESERVATION_CAP);
    for (const date of dates) {
      await client.reservation.create({
        data: { parkingSpotId: spot.id, userId: userB.id, date: toDateColumn(date) },
      });
    }

    await expect(
      client.$transaction((tx) => assertWithinMonthlyReservationCap(tx, userA.id, dates[0]))
    ).resolves.toBeUndefined();
  });

  it('does not count a reservation in a different calendar month', async () => {
    const user = await seedUser(client);
    const spot = await seedSpot(client);
    // `CAP - 1` in-month rows, so the assertion below sits exactly on the cap:
    // 4 + 1 = 5 passes, and the next-month row counted too would be 5 + 1 = 6
    // and would throw. Seeding fewer would make this test pass either way —
    // which it did, until the numbers were tightened to discriminate.
    const [inMonth, ...rest] = businessDaysInMonth(DEFAULT_MONTHLY_RESERVATION_CAP);
    for (const date of rest) {
      await client.reservation.create({
        data: { parkingSpotId: spot.id, userId: user.id, date: toDateColumn(date) },
      });
    }
    // One more, next month — must not push this month's count over the cap.
    const nextMonthDay = addDays(inMonth, 32) as DateOnly;
    expect(toYearMonth(nextMonthDay)).not.toBe(toYearMonth(inMonth));
    await client.reservation.create({
      data: { parkingSpotId: spot.id, userId: user.id, date: toDateColumn(nextMonthDay) },
    });

    await expect(
      client.$transaction((tx) => assertWithinMonthlyReservationCap(tx, user.id, inMonth))
    ).resolves.toBeUndefined();
  });

  it('serializes two callers on the same (user, month), so the recount is authoritative', async () => {
    const user = await seedUser(client);
    const spot = await seedSpot(client);
    const dates = businessDaysInMonth(DEFAULT_MONTHLY_RESERVATION_CAP);
    for (const date of dates.slice(0, DEFAULT_MONTHLY_RESERVATION_CAP - 1)) {
      await client.reservation.create({
        data: { parkingSpotId: spot.id, userId: user.id, date: toDateColumn(date) },
      });
    }
    const lastDate = nth(dates, DEFAULT_MONTHLY_RESERVATION_CAP - 1);

    const other = connect();
    try {
      // A: passes at CAP-1, inserts the CAP-th row, then holds its locks.
      const held = holdTransaction(client, async (tx) => {
        await assertWithinMonthlyReservationCap(tx, user.id, dates[0]);
        await tx.reservation.create({
          data: { parkingSpotId: spot.id, userId: user.id, date: toDateColumn(lastDate) },
        });
      });
      await held.ready;

      // B: must block on the advisory lock, not read a stale count of CAP-1.
      const second = codeOf(
        other.$transaction((tx) => assertWithinMonthlyReservationCap(tx, user.id, dates[0]))
      );
      await waitForBlockedBackend(other);
      held.release();
      await held.done;

      expect(await second).toBe('MONTHLY_RESERVATION_LIMIT_REACHED');
    } finally {
      await other.$disconnect();
    }
  });
});
