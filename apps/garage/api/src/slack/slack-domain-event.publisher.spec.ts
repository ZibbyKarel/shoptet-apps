/**
 * What the after-commit seam turns into a Slack message, and what it does not.
 *
 * The events here are built from the realtime contract's own types, so an event
 * the contract does not declare will not compile — the same guarantee
 * `reservation-events.ts` gives the rest of the application.
 */

import type { DomainEvent, WaitlistPromotionNotice } from '../reservations/reservation-events';
import type { ShutdownCloser } from '../shutdown/graceful-shutdown.service';
import { GracefulShutdownService } from '../shutdown/graceful-shutdown.service';
import { SlackDomainEventPublisher } from './slack-domain-event.publisher';
import type { SlackNotificationService } from './slack-notification.service';
import type { CapturedLogs } from './testing/capture-logs';
import { captureLogs } from './testing/capture-logs';

const SPOT = '0198f4c1-0000-7000-8000-000000000001';
const DATE = '2026-09-29';

/** Lets a test await work the publisher deliberately does not await. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function cancelled(): DomainEvent {
  return {
    name: 'reservation:cancelled',
    payload: { date: DATE, parkingSpotId: SPOT, reservationId: 'r-1' },
  };
}

/** A promise plus its resolver, for holding a detached notification open. */
function deferred(): { promise: Promise<unknown>; resolve: (v: unknown) => void } {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('SlackDomainEventPublisher', () => {
  let logs: CapturedLogs;
  let notifications: {
    notifySpotFreed: jest.Mock;
    notifyWaitlistPromotion: jest.Mock;
  };
  /** The closer the publisher registered, so shutdown can be driven for real. */
  let closers: Map<string, ShutdownCloser>;
  let publisher: SlackDomainEventPublisher;

  beforeEach(() => {
    logs = captureLogs();
    notifications = {
      notifySpotFreed: jest.fn().mockResolvedValue('delivered'),
      notifyWaitlistPromotion: jest.fn().mockResolvedValue('delivered'),
    };
    closers = new Map();
    const shutdown = {
      registerCloser(name: string, close: ShutdownCloser): void {
        closers.set(name, close);
      },
    } as unknown as GracefulShutdownService;
    publisher = new SlackDomainEventPublisher(
      notifications as unknown as SlackNotificationService,
      logs.logger,
      shutdown
    );
  });

  describe('publish', () => {
    it('announces a cancellation that left the spot free', async () => {
      publisher.publish([cancelled()]);
      await flush();

      expect(notifications.notifySpotFreed).toHaveBeenCalledWith({
        parkingSpotId: SPOT,
        date: DATE,
        reservationId: 'r-1',
      });
    });

    it('says nothing about a reassignment — the promoted person gets a DM instead', async () => {
      // The contract emits `reservation:reassigned` *instead of*
      // `reservation:cancelled` when a promotion happened, so filtering on
      // `cancelled` is what stops the channel announcing a spot that is
      // already taken. Nothing here re-derives that from the notices.
      publisher.publish([
        {
          name: 'reservation:reassigned',
          payload: {
            date: DATE,
            parkingSpotId: SPOT,
            cause: 'WAITLIST_PROMOTION',
            previousReservationId: 'r-1',
            fromWaitlistEntryId: 'w-1',
            reservation: {
              id: 'r-2',
              createdAt: '2026-09-01T00:00:00.000Z',
              holder: { kind: 'USER', userId: 'u-2', name: 'Jana', licensePlate: null },
            },
          },
        },
      ]);
      await flush();

      expect(notifications.notifySpotFreed).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: 'reservation:created',
        payload: {
          date: DATE,
          parkingSpotId: SPOT,
          reservation: {
            id: 'r-3',
            createdAt: '2026-09-01T00:00:00.000Z',
            holder: { kind: 'USER', userId: 'u-1', name: 'Petr', licensePlate: null },
          },
        },
      },
      { name: 'waitlist:updated', payload: { date: DATE, parkingSpotId: SPOT, waitlistCount: 2 } },
      { name: 'cell:unlocked', payload: { date: DATE, parkingSpotId: SPOT } },
    ] as DomainEvent[])('ignores %s', async (event: DomainEvent) => {
      publisher.publish([event]);
      await flush();

      expect(notifications.notifySpotFreed).not.toHaveBeenCalled();
    });

    it('handles a batch, announcing only the cancellations in it', async () => {
      publisher.publish([
        cancelled(),
        {
          name: 'waitlist:updated',
          payload: { date: DATE, parkingSpotId: SPOT, waitlistCount: 0 },
        },
      ]);
      await flush();

      expect(notifications.notifySpotFreed).toHaveBeenCalledTimes(1);
    });

    it('still announces a cancellation that comes after another event in the batch', async () => {
      // The case above puts the cancellation first, so a loop that `break`s
      // instead of `continue`s on the first non-matching event would still
      // pass it — the early exit is never reached. Reversing the order is
      // what actually distinguishes "skip this one" from "stop looking".
      publisher.publish([
        {
          name: 'waitlist:updated',
          payload: { date: DATE, parkingSpotId: SPOT, waitlistCount: 0 },
        },
        cancelled(),
      ]);
      await flush();

      expect(notifications.notifySpotFreed).toHaveBeenCalledTimes(1);
    });

    it('returns before the Slack call finishes — the user is not made to wait', () => {
      let settled = false;
      notifications.notifySpotFreed.mockImplementation(
        () =>
          new Promise((resolve) =>
            setImmediate(() => {
              settled = true;
              resolve('delivered');
            })
          )
      );

      publisher.publish([cancelled()]);

      expect(settled).toBe(false);
    });
  });

  describe('notifyPromotions', () => {
    const notice: WaitlistPromotionNotice = {
      userId: 'u-9',
      parkingSpotId: SPOT,
      date: DATE,
      reservationId: 'r-9',
    };

    it('sends one DM per promoted person', async () => {
      publisher.notifyPromotions([notice, { ...notice, userId: 'u-10', reservationId: 'r-10' }]);
      await flush();

      expect(notifications.notifyWaitlistPromotion).toHaveBeenCalledTimes(2);
      expect(notifications.notifyWaitlistPromotion).toHaveBeenCalledWith(notice);
    });

    it('does nothing when nobody was promoted', async () => {
      publisher.notifyPromotions([]);
      await flush();

      expect(notifications.notifyWaitlistPromotion).not.toHaveBeenCalled();
    });
  });

  describe('a notification that throws', () => {
    it('does not escape into the caller, which is a committed domain operation', async () => {
      notifications.notifySpotFreed.mockRejectedValue(new Error('unexpected'));

      // Synchronous: `publish` returns `void`, so a throw here would land in
      // `ReservationsService.cancel` *after* the transaction committed and turn
      // a successful cancellation into a 500.
      expect(() => publisher.publish([cancelled()])).not.toThrow();
      await flush();

      expect(logs.lines()).toContainEqual(
        expect.objectContaining({
          message: 'Slack notification threw unexpectedly',
          notification: 'spot-freed',
        })
      );
    });

    it('does not escape from a promotion DM either', async () => {
      notifications.notifyWaitlistPromotion.mockRejectedValue(new Error('unexpected'));

      expect(() =>
        publisher.notifyPromotions([
          { userId: 'u-9', parkingSpotId: SPOT, date: DATE, reservationId: 'r-9' },
        ])
      ).not.toThrow();
      await flush();

      expect(logs.lines()).toContainEqual(
        expect.objectContaining({ notification: 'waitlist-promoted' })
      );
    });

    it('lets the rest of the batch through', async () => {
      notifications.notifySpotFreed
        .mockRejectedValueOnce(new Error('unexpected'))
        .mockResolvedValueOnce('delivered');

      publisher.publish([cancelled(), { ...cancelled() }]);
      await flush();

      expect(notifications.notifySpotFreed).toHaveBeenCalledTimes(2);
    });
  });

  describe('shutdown', () => {
    it('registers itself with the shutdown registry, under a greppable name', () => {
      expect([...closers.keys()]).toEqual(['slack-notifications']);
    });

    it('does not hang when nothing is in flight', async () => {
      await expect(
        Promise.resolve(closers.get('slack-notifications')?.())
      ).resolves.toBeUndefined();
    });

    it('waits for a detached spot-freed notification before letting the process exit', async () => {
      const held = deferred();
      notifications.notifySpotFreed.mockReturnValue(held.promise);

      publisher.publish([cancelled()]);

      let drained = false;
      const draining = Promise.resolve(closers.get('slack-notifications')?.()).then(() => {
        drained = true;
      });

      // A full macrotask turn, not a microtask flush: if the closer resolved
      // without waiting, `drained` would be true by now.
      await new Promise((resolve) => setImmediate(resolve));
      expect(drained).toBe(false);

      held.resolve('delivered');
      await draining;
      expect(drained).toBe(true);
    });

    it('waits for a detached promotion DM the same way', async () => {
      const held = deferred();
      notifications.notifyWaitlistPromotion.mockReturnValue(held.promise);

      publisher.notifyPromotions([
        { userId: 'u-9', parkingSpotId: SPOT, date: DATE, reservationId: 'r-9' },
      ]);

      let drained = false;
      const draining = Promise.resolve(closers.get('slack-notifications')?.()).then(() => {
        drained = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(drained).toBe(false);

      held.resolve('delivered');
      await draining;
      expect(drained).toBe(true);
    });

    it('is not held open by a notification that fails while draining', async () => {
      const held = deferred();
      notifications.notifySpotFreed.mockReturnValue(
        held.promise.then(() => {
          throw new Error('boom');
        })
      );

      publisher.publish([cancelled()]);
      const draining = Promise.resolve(closers.get('slack-notifications')?.());
      held.resolve(undefined);

      await expect(draining).resolves.toBeUndefined();
    });

    it('stops tracking a notification once it settles, so a later drain does not wait for it again', async () => {
      publisher.publish([cancelled()]);
      await flush();

      await expect(
        Promise.resolve(closers.get('slack-notifications')?.())
      ).resolves.toBeUndefined();
    });
  });
});
