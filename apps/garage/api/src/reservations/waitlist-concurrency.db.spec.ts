/**
 * The races. Real transactions, real locks, real `P2002`s.
 *
 * Task 12's report named this the one thing the whole build had not proven:
 * *"two simultaneous requests, one winner" is unproven anywhere*. This file is
 * that proof, and it is written to be **falsifiable**: every case here fails
 * when the mechanism it covers is removed, and the task report records the
 * failure output from actually removing it.
 *
 * ## Why some cases use a held transaction instead of `Promise.all`
 *
 * A previous task in this build shipped an HTTP-level concurrency test that
 * passed with the retry logic deleted, because each `fetch` cost enough
 * event-loop time that the two requests never overlapped. Firing two promises
 * and hoping is not a race; it is two operations that usually run in sequence.
 *
 * So the cases whose whole point is a specific interleaving open a transaction,
 * stop it at the exact statement that matters
 * (`holdTransaction` in `src/testing/database/reservation-harness.ts`), start the
 * other operation, wait for a backend to actually block
 * (`waitForBlockedBackend`, which reads `pg_stat_activity` rather than sleeping),
 * and only then let the first one commit. That interleaving is not probable —
 * it is forced.
 *
 * The genuinely parallel cases (`Promise.allSettled` over N callers) are kept
 * as well, because "many callers, one winner" is a different claim from "this
 * exact interleaving is handled", and both are load-bearing.
 */

import type { PrismaClient } from '@garage/database';
import { toDateColumn } from '../common/prisma-mapping';
import type { Harness } from '../testing/database/reservation-harness';
import {
  FUTURE_BUSINESS_DAY,
  TODAY,
  actorFor,
  buildHarness,
  codeOfRejection,
  connect,
  holdTransaction,
  seedSpot,
  seedUser,
  setLockMode,
  waitForBlockedBackend,
} from '../testing/database/reservation-harness';

describe('two requests at once', () => {
  let client: PrismaClient;
  /** A second pool, so the two sides of a race are genuinely separate sessions. */
  let otherClient: PrismaClient;
  let harness: Harness;
  let otherHarness: Harness;

  beforeAll(() => {
    client = connect();
    otherClient = connect();
    harness = buildHarness(client);
    otherHarness = buildHarness(otherClient);
  });

  afterAll(async () => {
    await Promise.all([client.$disconnect(), otherClient.$disconnect()]);
  });

  beforeEach(async () => {
    harness.publisher.reset();
    otherHarness.publisher.reset();
    await setLockMode(client, 'AUTO');
  });

  describe('racing for the same free spot', () => {
    it('gives it to exactly one of two simultaneous creates', async () => {
      const [first, second, spot] = [
        await seedUser(client),
        await seedUser(client),
        await seedSpot(client),
      ];

      const outcomes = await Promise.allSettled([
        harness.reservations.create(
          { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
          actorFor(first),
          TODAY
        ),
        otherHarness.reservations.create(
          { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
          actorFor(second),
          TODAY
        ),
      ]);

      const won = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const lost = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost.map(codeOfRejection)).toEqual(['SPOT_ALREADY_RESERVED']);
      expect(
        await client.reservation.count({
          where: { parkingSpotId: spot.id, date: toDateColumn(FUTURE_BUSINESS_DAY) },
        })
      ).toBe(1);
    });

    it('gives it to exactly one of eight, and the other seven are told why', async () => {
      const spot = await seedSpot(client);
      const users = await Promise.all(Array.from({ length: 8 }, () => seedUser(client)));

      const outcomes = await Promise.allSettled(
        users.map((user, index) =>
          (index % 2 === 0 ? harness : otherHarness).reservations.create(
            { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
            actorFor(user),
            TODAY
          )
        )
      );

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      // Every loser gets the *specific* code, not the vague `CONFLICT` — which
      // is the mapping that could never fire before `database-contract.db.spec.ts`
      // discovered `meta.target` does not exist on this driver.
      expect(
        outcomes.filter((outcome) => outcome.status === 'rejected').map(codeOfRejection)
      ).toEqual(Array.from({ length: 7 }, () => 'SPOT_ALREADY_RESERVED'));
    });

    it('lets a create wait for an in-flight cancellation and then lose to the promotion', async () => {
      const [holder, waiter, latecomer, spot] = [
        await seedUser(client),
        await seedUser(client),
        await seedUser(client),
        await seedSpot(client),
      ];
      const reservation = await harness.reservations.create(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(holder),
        TODAY
      );
      await harness.waitlist.join(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(waiter),
        TODAY
      );

      const outcomes = await Promise.allSettled([
        harness.reservations.cancel({ reservationId: reservation.id }, actorFor(holder)),
        otherHarness.reservations.create(
          { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
          actorFor(latecomer),
          TODAY
        ),
      ]);

      // The cancellation always wins: the old row is still committed while it
      // runs, so the latecomer's insert either fails against that row or waits
      // for the promotion to take its place.
      expect(outcomes[0]?.status).toBe('fulfilled');
      expect(outcomes[1]?.status).toBe('rejected');
      expect(codeOfRejection(outcomes[1] as PromiseSettledResult<unknown>)).toBe(
        'SPOT_ALREADY_RESERVED'
      );

      const current = await client.reservation.findUniqueOrThrow({
        where: {
          parkingSpotId_date: { parkingSpotId: spot.id, date: toDateColumn(FUTURE_BUSINESS_DAY) },
        },
      });
      expect(current.userId).toBe(waiter.id);
    });
  });

  describe('two cancellations of the same reservation', () => {
    it('produces one cancellation, one NOT_FOUND, and exactly one promotion', async () => {
      const [holder, waiter, other, spot] = [
        await seedUser(client),
        await seedUser(client),
        await seedUser(client),
        await seedSpot(client),
      ];
      const reservation = await harness.reservations.create(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(holder),
        TODAY
      );
      await harness.waitlist.join(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(waiter),
        TODAY
      );
      await harness.waitlist.join(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(other),
        TODAY
      );

      const outcomes = await Promise.allSettled([
        harness.reservations.cancel({ reservationId: reservation.id }, actorFor(holder)),
        otherHarness.reservations.cancel({ reservationId: reservation.id }, actorFor(holder)),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === 'rejected').map(codeOfRejection)
      ).toEqual(['NOT_FOUND']);

      // The rule this is really about: the queue must be served once, not twice.
      const promotions = await client.auditLog.count({
        where: {
          action: 'WAITLIST_PROMOTED',
          payload: { path: ['parkingSpotId'], equals: spot.id },
        },
      });
      expect(promotions).toBe(1);
      expect(
        await client.reservation.count({
          where: { parkingSpotId: spot.id, date: toDateColumn(FUTURE_BUSINESS_DAY) },
        })
      ).toBe(1);
    });
  });

  describe('the row lock on the queue', () => {
    /**
     * The interleaving `SELECT … FOR UPDATE` exists for, forced rather than
     * hoped for.
     *
     * `leave` deletes the head of the queue and stops before committing. The
     * cancellation then starts and blocks on that row. Only then does `leave`
     * commit — and the promotion must go to the **second** waiter, because the
     * first one left.
     *
     * Without the lock the promotion's read does not block; it sees the
     * still-visible uncommitted-deleted row and hands a spot to somebody who
     * asked to be taken out of the queue. The task report has that failure.
     */
    it('makes a promotion wait for an in-flight leave, and then skip the leaver', async () => {
      const [holder, leaving, staying, spot] = [
        await seedUser(client),
        await seedUser(client),
        await seedUser(client),
        await seedSpot(client),
      ];
      const reservation = await harness.reservations.create(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(holder),
        TODAY
      );
      const first = await harness.waitlist.join(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(leaving),
        TODAY
      );
      const second = await harness.waitlist.join(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(staying),
        TODAY
      );
      expect([first.position, second.position]).toEqual([1, 2]);

      const held = holdTransaction(otherClient, (tx) =>
        tx.waitlistEntry.delete({ where: { id: first.entry.id } })
      );
      await held.ready;

      const cancelling = harness.reservations.cancel(
        { reservationId: reservation.id },
        actorFor(holder)
      );
      // Proves the cancellation really is stuck on the lock rather than having
      // sailed past it. Throws if nothing ever blocks.
      await waitForBlockedBackend(client);

      held.release();
      await held.done;
      const result = await cancelling;

      expect(result.promoted).toBe(true);
      const promoted = await client.reservation.findUniqueOrThrow({
        where: {
          parkingSpotId_date: { parkingSpotId: spot.id, date: toDateColumn(FUTURE_BUSINESS_DAY) },
        },
      });
      expect(promoted.userId).toBe(staying.id);
      expect(promoted.userId).not.toBe(leaving.id);
    });
  });

  describe('a promotion that loses to a unique-constraint conflict', () => {
    /**
     * The retry, forced.
     *
     * A reservation for the head of the queue is written on another connection
     * and **held uncommitted**. The cancellation then promotes that same person
     * — its eligibility read cannot see the uncommitted row — and its `INSERT`
     * blocks on `Reservation (userId, date)`. Releasing the held transaction
     * turns that block into a `P2002`, the whole cancel transaction rolls back,
     * and the retry re-reads: this time the conflicting reservation *is*
     * committed, so the head is skipped and the next person is promoted.
     *
     * Without the retry the cancellation fails outright with
     * `RESERVATION_LIMIT_REACHED` — a code about a user the caller has never
     * heard of. The task report has that failure.
     */
    it('retries and promotes the next eligible person instead', async () => {
      const [holder, contested, next, spot, elsewhere] = [
        await seedUser(client),
        await seedUser(client),
        await seedUser(client),
        await seedSpot(client),
        await seedSpot(client),
      ];
      const reservation = await harness.reservations.create(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(holder),
        TODAY
      );
      const contestedEntry = await harness.waitlist.join(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(contested),
        TODAY
      );
      await harness.waitlist.join(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(next),
        TODAY
      );

      // Uncommitted: invisible to the promotion's eligibility read, but its key
      // is already in the unique index, so the promoting insert will block on it.
      const held = holdTransaction(otherClient, (tx) =>
        tx.reservation.create({
          data: {
            parkingSpotId: elsewhere.id,
            userId: contested.id,
            date: toDateColumn(FUTURE_BUSINESS_DAY),
          },
        })
      );
      await held.ready;

      const cancelling = harness.reservations.cancel(
        { reservationId: reservation.id },
        actorFor(holder)
      );
      await waitForBlockedBackend(client);

      held.release();
      await held.done;
      const result = await cancelling;

      expect(result.promoted).toBe(true);
      const promoted = await client.reservation.findUniqueOrThrow({
        where: {
          parkingSpotId_date: { parkingSpotId: spot.id, date: toDateColumn(FUTURE_BUSINESS_DAY) },
        },
      });
      expect(promoted.userId).toBe(next.id);

      // The contested waiter kept both their queue entry and the reservation
      // they won elsewhere. Nothing was rolled forward by half.
      expect(
        await client.waitlistEntry.findUnique({ where: { id: contestedEntry.entry.id } })
      ).not.toBeNull();
      expect(
        await client.reservation.count({
          where: { userId: contested.id, date: toDateColumn(FUTURE_BUSINESS_DAY) },
        })
      ).toBe(1);

      // Exactly one promotion was recorded: the attempt that rolled back left no
      // audit entry behind, which is the point of it being one transaction.
      expect(
        await client.auditLog.count({
          where: {
            action: 'WAITLIST_PROMOTED',
            payload: { path: ['parkingSpotId'], equals: spot.id },
          },
        })
      ).toBe(1);
    });

    it('is also survivable when both sides are ordinary concurrent cancellations', async () => {
      // The same conflict, arrived at without any orchestration: two cells being
      // freed at once whose queues are headed by the same person. Whichever
      // promotion gets there first takes them; the other must still succeed.
      const [holderOne, holderTwo, shared, backupOne, backupTwo] = [
        await seedUser(client),
        await seedUser(client),
        await seedUser(client),
        await seedUser(client),
        await seedUser(client),
      ];
      const [spotOne, spotTwo] = [await seedSpot(client), await seedSpot(client)];

      const first = await harness.reservations.create(
        { parkingSpotId: spotOne.id, date: FUTURE_BUSINESS_DAY },
        actorFor(holderOne),
        TODAY
      );
      const second = await harness.reservations.create(
        { parkingSpotId: spotTwo.id, date: FUTURE_BUSINESS_DAY },
        actorFor(holderTwo),
        TODAY
      );
      for (const spot of [spotOne, spotTwo]) {
        await harness.waitlist.join(
          { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
          actorFor(shared),
          TODAY
        );
      }
      await harness.waitlist.join(
        { parkingSpotId: spotOne.id, date: FUTURE_BUSINESS_DAY },
        actorFor(backupOne),
        TODAY
      );
      await harness.waitlist.join(
        { parkingSpotId: spotTwo.id, date: FUTURE_BUSINESS_DAY },
        actorFor(backupTwo),
        TODAY
      );

      const outcomes = await Promise.allSettled([
        harness.reservations.cancel({ reservationId: first.id }, actorFor(holderOne)),
        otherHarness.reservations.cancel({ reservationId: second.id }, actorFor(holderTwo)),
      ]);

      // Both must succeed. This is the case that found the deadlock: before the
      // retry covered `P2034`, one of these came back
      // `40P01 deadlock detected` — see the task report for the raw output.
      expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);

      const held = await client.reservation.findMany({
        where: {
          date: toDateColumn(FUTURE_BUSINESS_DAY),
          parkingSpotId: { in: [spotOne.id, spotTwo.id] },
        },
      });
      expect(held).toHaveLength(2);
      // The shared waiter took at most one of them — the rule the unique index
      // is there for.
      expect(held.filter((row) => row.userId === shared.id).length).toBeLessThanOrEqual(1);
      expect(new Set(held.map((row) => row.userId)).size).toBe(2);
    });
  });
});
