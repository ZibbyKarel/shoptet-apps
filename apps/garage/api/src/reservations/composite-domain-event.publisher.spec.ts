/**
 * The composite seam, proved by mutation rather than by inspection.
 *
 * A fan-out is the classic shape that passes its tests while only one branch
 * ever runs: two delegates, both healthy, and an assertion that "the event was
 * delivered" is satisfied by either of them. So every isolation test below
 * makes **one named side throw** and asserts, by name, that the *other* side
 * still ran — and separately that nothing reached the caller. Both directions
 * are tested, because a `try` that happens to wrap only the first delegate
 * would pass a one-directional suite.
 *
 * The delegates here are fakes rather than the real Socket.io and Slack
 * publishers on purpose. Neither of those throws today — the realtime one
 * catches per event, the Slack one detaches every promise — so a test built on
 * them could not distinguish "the composite isolates its delegates" from "the
 * delegates happen not to fail". The wiring that puts the *real* two behind
 * this class is asserted in `slack/slack.module.spec.ts` and
 * `realtime/realtime.gateway.spec.ts`.
 */

import type { PinoLogger } from 'nestjs-pino';
import { CompositeDomainEventPublisher } from './composite-domain-event.publisher';
import type { DomainEvent, WaitlistPromotionNotice } from './reservation-events';
import { DomainEventPublisher } from './reservation-events';

const DATE = '2026-09-15';
const SPOT = '11111111-1111-4111-8111-111111111111';
const RESERVATION = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

/** A delegate that records what it was handed, and optionally throws first. */
class RecordingPublisher extends DomainEventPublisher {
  readonly published: DomainEvent[] = [];
  readonly notified: WaitlistPromotionNotice[] = [];
  /** When set, thrown by `publish` *before* recording — the mutation. */
  publishThrows?: Error | undefined;
  /** When set, thrown by `notifyPromotions` before recording. */
  notifyThrows?: Error | undefined;

  publish(events: readonly DomainEvent[]): void {
    if (this.publishThrows !== undefined) {
      throw this.publishThrows;
    }
    this.published.push(...events);
  }

  notifyPromotions(notices: readonly WaitlistPromotionNotice[]): void {
    if (this.notifyThrows !== undefined) {
      throw this.notifyThrows;
    }
    this.notified.push(...notices);
  }
}

/**
 * A delegate that breaks the seam's `void` contract by being `async`.
 *
 * This **compiles** as a `DomainEventPublisher`: TypeScript's void-return
 * assignability rule lets a method returning `Promise<void>` satisfy an
 * abstract `publish(...): void`, so the abstract-class token — chosen precisely
 * so a replacement "cannot silently have the wrong shape" — does not stop it.
 * The class exists to pin what the composite does about that at runtime.
 *
 * `@typescript-eslint/no-misused-promises` is what now stops the same
 * declaration everywhere else in `apps/garage/api` and `libs` — see the block in
 * `eslint.config.mjs` that enables it. The two disables below are the single
 * deliberate waiver: this class is not a delegate anyone ships, it is the
 * fixture that proves the composite's runtime guard still holds when a
 * delegate arrives through DI from outside the linter's reach. Silence the
 * static half here, or there is nothing left to test the dynamic half with.
 */
class AsyncRejectingPublisher extends DomainEventPublisher {
  calls = 0;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- deliberate: an `async` override of the `void` seam is the thing under test.
  async publish(): Promise<void> {
    this.calls += 1;
    throw new Error('async transport rejected');
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- deliberate: an `async` override of the `void` seam is the thing under test.
  async notifyPromotions(): Promise<void> {
    this.calls += 1;
    throw new Error('async transport rejected');
  }
}

function cancelled(reservationId = RESERVATION): DomainEvent {
  return {
    name: 'reservation:cancelled',
    payload: { date: DATE, parkingSpotId: SPOT, reservationId },
  };
}

function waitlistUpdated(): DomainEvent {
  return {
    name: 'waitlist:updated',
    payload: { date: DATE, parkingSpotId: SPOT, waitlistCount: 2 },
  };
}

function promotion(): WaitlistPromotionNotice {
  return { userId: USER, parkingSpotId: SPOT, date: DATE, reservationId: RESERVATION };
}

describe('CompositeDomainEventPublisher', () => {
  let realtime: RecordingPublisher;
  let slack: RecordingPublisher;
  let errors: { bindings: Record<string, unknown>; message: string }[];
  let publisher: CompositeDomainEventPublisher;
  /** Rejections Node saw escape into the process — must stay empty. */
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };

  /** A `PinoLogger` double that records `error` calls into {@link errors}. */
  function logger(): PinoLogger {
    return {
      error: (bindings: Record<string, unknown>, message: string) => {
        errors.push({ bindings, message });
      },
    } as unknown as PinoLogger;
  }

  beforeEach(() => {
    realtime = new RecordingPublisher();
    slack = new RecordingPublisher();
    errors = [];
    unhandled = [];
    // A rejection escaping the composite is the failure mode under test, and it
    // is invisible to `expect` — Node reports it on the process, not to the
    // caller. Listening for it is what makes the async tests falsifiable
    // rather than merely green.
    process.on('unhandledRejection', onUnhandled);
    publisher = new CompositeDomainEventPublisher([realtime, slack], logger());
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  describe('the healthy path', () => {
    it('hands every event to every delegate', () => {
      publisher.publish([cancelled(), waitlistUpdated()]);

      expect(realtime.published.map((event) => event.name)).toEqual([
        'reservation:cancelled',
        'waitlist:updated',
      ]);
      expect(slack.published.map((event) => event.name)).toEqual([
        'reservation:cancelled',
        'waitlist:updated',
      ]);
      expect(errors).toEqual([]);
    });

    it('hands every promotion notice to every delegate', () => {
      publisher.notifyPromotions([promotion()]);

      expect(realtime.notified).toEqual([promotion()]);
      expect(slack.notified).toEqual([promotion()]);
    });

    it('publishes nothing at all for an empty batch', () => {
      publisher.publish([]);
      publisher.notifyPromotions([]);

      expect(realtime.published).toEqual([]);
      expect(slack.published).toEqual([]);
      expect(realtime.notified).toEqual([]);
      expect(slack.notified).toEqual([]);
    });
  });

  describe('one implementation throwing does not silence the other', () => {
    // The mutation table. Each row makes exactly one named side fail and names
    // the side that must still have run; a composite with a single `try` around
    // both delegates fails the row whose victim comes second.

    it('still reaches Slack when the realtime publisher throws on publish', () => {
      realtime.publishThrows = new Error('socket write failed');

      publisher.publish([cancelled()]);

      expect(realtime.published).toEqual([]);
      expect(slack.published.map((event) => event.name)).toEqual(['reservation:cancelled']);
    });

    it('still reaches the realtime publisher when Slack throws on publish', () => {
      slack.publishThrows = new Error('slack notification failed');

      publisher.publish([cancelled()]);

      expect(slack.published).toEqual([]);
      expect(realtime.published.map((event) => event.name)).toEqual(['reservation:cancelled']);
    });

    it('still reaches Slack when the realtime publisher throws on notifyPromotions', () => {
      realtime.notifyThrows = new Error('socket write failed');

      publisher.notifyPromotions([promotion()]);

      expect(realtime.notified).toEqual([]);
      expect(slack.notified).toEqual([promotion()]);
    });

    it('still reaches the realtime publisher when Slack throws on notifyPromotions', () => {
      slack.notifyThrows = new Error('slack notification failed');

      publisher.notifyPromotions([promotion()]);

      expect(slack.notified).toEqual([]);
      expect(realtime.notified).toEqual([promotion()]);
    });

    it('keeps delivering to a delegate that failed on an earlier event', () => {
      // Per-event isolation *within* one delegate, not only between delegates:
      // the realtime side throws on the first event only, and must still be
      // handed the second. A composite that gave each delegate the whole batch
      // in one `try` would lose it.
      realtime.publishThrows = new Error('socket write failed');

      publisher.publish([cancelled()]);
      realtime.publishThrows = undefined;
      publisher.publish([waitlistUpdated()]);

      expect(realtime.published.map((event) => event.name)).toEqual(['waitlist:updated']);
    });

    it('delivers the second fact when a delegate throws on the first, in one call', () => {
      // The same property inside a single `publish`, which is how a promoting
      // cancellation actually arrives: `reservation:reassigned` and
      // `waitlist:updated` together. The delegate throws only for the
      // reassignment, so the queue-length fact must still get through.
      const selective = new (class extends DomainEventPublisher {
        readonly seen: string[] = [];
        publish(events: readonly DomainEvent[]): void {
          for (const event of events) {
            if (event.name === 'reservation:cancelled') {
              throw new Error('socket write failed');
            }
            this.seen.push(event.name);
          }
        }
        notifyPromotions(): void {
          // Not exercised by this test.
        }
      })();
      publisher = new CompositeDomainEventPublisher([selective], {
        error: () => undefined,
      } as unknown as PinoLogger);

      publisher.publish([cancelled(), waitlistUpdated()]);

      expect(selective.seen).toEqual(['waitlist:updated']);
    });

    it('reaches every remaining delegate when both of the first two throw', () => {
      // Three delegates, the first two failing: proves the loop continues
      // rather than merely tolerating one failure.
      const third = new RecordingPublisher();
      realtime.publishThrows = new Error('socket write failed');
      slack.publishThrows = new Error('slack notification failed');
      publisher = new CompositeDomainEventPublisher([realtime, slack, third], {
        error: () => undefined,
      } as unknown as PinoLogger);

      publisher.publish([cancelled()]);

      expect(third.published.map((event) => event.name)).toEqual(['reservation:cancelled']);
    });
  });

  describe('a delegate that breaks the void contract by being async', () => {
    // The seam is `void` on purpose: it is called on the request's way out and
    // must not become anyone's async boundary. But `void` does not *stop* an
    // async delegate — `AsyncRejectingPublisher` compiles — and an escaping
    // rejection is worse than an escaping throw: `apps/garage/api` installs no
    // `unhandledRejection` handler, so under Node's default it would terminate
    // the API process, after `COMMIT`, on a user's cancellation path. These
    // tests pin that the composite contains it.

    it('does not let an async delegate rejection escape publish', async () => {
      const rejecting = new AsyncRejectingPublisher();
      publisher = new CompositeDomainEventPublisher([rejecting, slack], logger());

      expect(() => publisher.publish([cancelled()])).not.toThrow();
      await flushMicrotasks();

      expect(rejecting.calls).toBe(1);
      expect(unhandled).toEqual([]);
    });

    it('does not let an async delegate rejection escape notifyPromotions', async () => {
      const rejecting = new AsyncRejectingPublisher();
      publisher = new CompositeDomainEventPublisher([rejecting, slack], logger());

      expect(() => publisher.notifyPromotions([promotion()])).not.toThrow();
      await flushMicrotasks();

      expect(rejecting.calls).toBe(1);
      expect(unhandled).toEqual([]);
    });

    it('still reaches the other delegate when an async delegate rejects', async () => {
      // The isolation property, for the async case: the healthy delegate must
      // run even though the one before it returned a promise that rejects.
      const rejecting = new AsyncRejectingPublisher();
      publisher = new CompositeDomainEventPublisher([rejecting, slack], logger());

      publisher.publish([cancelled()]);
      await flushMicrotasks();

      expect(slack.published.map((event) => event.name)).toEqual(['reservation:cancelled']);
    });

    it('logs an async rejection the same way it logs a synchronous throw', async () => {
      const rejecting = new AsyncRejectingPublisher();
      publisher = new CompositeDomainEventPublisher([rejecting, slack], logger());

      publisher.publish([cancelled()]);
      await flushMicrotasks();

      expect(errors).toHaveLength(1);
      expect(onlyError().bindings['publisher']).toBe('AsyncRejectingPublisher');
      expect(onlyError().bindings['method']).toBe('publish');
      expect(onlyError().bindings['subject']).toBe('reservation:cancelled');
      expect(Object.keys(onlyError().bindings).sort()).toEqual([
        'err',
        'method',
        'publisher',
        'subject',
      ]);
    });

    it('does not wait for an async delegate before returning', async () => {
      // Containing the rejection must not turn the seam into a blocking call:
      // `publish` returns before the delegate's promise settles, so a slow
      // transport cannot be added to a user's cancellation path by accident.
      let settle = (): void => undefined;
      const slow = new (class extends DomainEventPublisher {
        publish(): void {
          // Returns a pending promise, despite the `void` signature.
          return new Promise<void>((resolve) => {
            settle = resolve;
          }) as unknown as void;
        }
        notifyPromotions(): void {
          // Not exercised by this test.
        }
      })();
      publisher = new CompositeDomainEventPublisher([slow, slack], logger());

      publisher.publish([cancelled()]);

      // Reached synchronously, with the delegate's promise still pending.
      expect(slack.published).toHaveLength(1);
      settle();
      await flushMicrotasks();
    });
  });

  describe('nothing reaches the caller', () => {
    // `reservation-events.ts`: a failure to broadcast "must never turn a
    // successful cancellation into an error the user sees". A user told their
    // cancellation failed will cancel again, against a row that is gone.

    it('does not throw when the realtime publisher throws on publish', () => {
      realtime.publishThrows = new Error('socket write failed');

      expect(() => publisher.publish([cancelled()])).not.toThrow();
    });

    it('does not throw when Slack throws on publish', () => {
      slack.publishThrows = new Error('slack notification failed');

      expect(() => publisher.publish([cancelled()])).not.toThrow();
    });

    it('does not throw when both throw on publish', () => {
      realtime.publishThrows = new Error('socket write failed');
      slack.publishThrows = new Error('slack notification failed');

      expect(() => publisher.publish([cancelled()])).not.toThrow();
    });

    it('does not throw when either side throws on notifyPromotions', () => {
      realtime.notifyThrows = new Error('socket write failed');
      slack.notifyThrows = new Error('slack notification failed');

      expect(() => publisher.notifyPromotions([promotion()])).not.toThrow();
    });
  });

  describe('what a failure logs', () => {
    it('logs the failure at error with the original error, naming the delegate and the event', () => {
      const thrown = new Error('socket write failed');
      realtime.publishThrows = thrown;

      publisher.publish([cancelled()]);

      expect(errors).toHaveLength(1);
      expect(onlyError().bindings).toEqual({
        err: thrown,
        publisher: 'RecordingPublisher',
        method: 'publish',
        subject: 'reservation:cancelled',
      });
      expect(onlyError().message).toContain('failed');
    });

    it('logs once per failing delegate, not once per call', () => {
      realtime.publishThrows = new Error('socket write failed');
      slack.publishThrows = new Error('slack notification failed');

      publisher.publish([cancelled()]);

      expect(errors.map((entry) => entry.bindings['method'])).toEqual(['publish', 'publish']);
    });

    it('names notifyPromotions as the method when a promotion notice fails', () => {
      realtime.notifyThrows = new Error('slack lookup failed');

      publisher.notifyPromotions([promotion()]);

      expect(onlyError().bindings['method']).toBe('notifyPromotions');
      // Not a `namespace:verb` literal: a promotion notice has no contract
      // event, and `subject` must not send a log reader grepping the contract
      // for a name that was never there.
      expect(onlyError().bindings['subject']).toBe('waitlist promotion notice');
      expect(onlyError().bindings['subject']).not.toContain(':');
    });

    it('logs no payload, so a redacted field cannot re-enter the log here', () => {
      // The composite logs the event *name*, never `event.payload`. Nothing in
      // a domain event is a credential today, but the seam is the one place
      // every committed fact passes through, and the project's rule is that a
      // token or a JWT never reaches a log line.
      realtime.publishThrows = new Error('socket write failed');

      publisher.publish([cancelled()]);

      expect(Object.keys(onlyError().bindings).sort()).toEqual([
        'err',
        'method',
        'publisher',
        'subject',
      ]);
      expect(JSON.stringify(onlyError().bindings)).not.toContain(RESERVATION);
    });

    it('logs nothing when every delegate succeeds', () => {
      publisher.publish([cancelled(), waitlistUpdated()]);
      publisher.notifyPromotions([promotion()]);

      expect(errors).toEqual([]);
    });
  });

  /**
   * Lets pending microtasks *and* one macrotask turn run.
   *
   * Node emits `unhandledRejection` only after the microtask queue has drained,
   * so awaiting a bare promise is not enough to observe an escape: a test that
   * did that would pass whether or not the rejection was contained.
   */
  async function flushMicrotasks(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  /** The single logged failure, asserted to be single rather than assumed. */
  function onlyError(): { bindings: Record<string, unknown>; message: string } {
    const [first, ...rest] = errors;
    if (first === undefined || rest.length > 0) {
      throw new Error(`expected exactly one logged error, got ${errors.length}`);
    }
    return first;
  }
});
