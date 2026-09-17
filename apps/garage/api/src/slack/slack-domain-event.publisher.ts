/**
 * The Slack end of the after-commit seam.
 *
 * `apps/garage/api/src/reservations/reservation-events.ts` declares
 * `DomainEventPublisher` with a no-op default and says in as many words that
 * Task 16 turns `notifyPromotions` into an outbound `chat.postMessage`. This is
 * that implementation. It reuses the existing seam rather than adding a second
 * one, so the guarantee the seam already carries — the services call it strictly
 * after `COMMIT`, outside the cancel retry loop, so a message is sent once and
 * only about something that actually happened — is inherited rather than
 * re-argued.
 *
 * ## Which events produce a Slack message, and why only those
 *
 * | Event | Slack |
 * | --- | --- |
 * | `reservation:cancelled` | freed-spot notice to the shared channel |
 * | `reservation:reassigned` | **nothing** — the promotion DM covers it |
 * | `reservation:created` | nothing |
 * | `waitlist:updated`, `cell:*` | nothing |
 *
 * The first two rows are one decision, and the realtime contract already made
 * it: a cancellation that promoted somebody emits `reservation:reassigned`
 * *instead of* `reservation:cancelled`, never both. So "a spot came free and
 * stayed free" is exactly `reservation:cancelled`, and there is no chance of
 * announcing a free spot that was taken in the same transaction. Nothing here
 * re-derives that from the promotion notices; it falls out of the contract.
 *
 * The other rows are the scope boundary. A reservation someone made themselves
 * is not news, and `cell:locked` fires every time a user hovers over a tile.
 *
 * ## Why the calls are not awaited
 *
 * The seam's contract is `void`: it is called on a request's way out, and
 * `ReservationsService.cancel` returns immediately afterwards. Awaiting a Slack
 * round trip — with up to `SLACK_RETRY_ATTEMPTS` attempts and a backoff — would
 * add seconds to the user's cancellation to tell somebody else about it. Every
 * detached promise is caught here, so a Slack failure can never surface as an
 * unhandled rejection, and `SlackClient` does not throw in the first place.
 *
 * Not awaited does not mean untracked: every detached call is held in
 * {@link inFlight} and registered as a `GracefulShutdownService` closer, the
 * same mechanism `ScheduledJobRunner` uses for job bodies. Without this, a
 * SIGTERM landing right after a commit would race the detached notification
 * against `PrismaService.onModuleDestroy` closing the pool in the same
 * shutdown window — the read inside `SlackNotificationService` would fail
 * against a closing connection, or the Slack POST itself (up to
 * `SLACK_RETRY_ATTEMPTS × SLACK_REQUEST_TIMEOUT_MS` plus backoff) would be
 * abandoned mid-flight, silently dropping the freed-spot notice on every
 * deploy that coincides with a cancellation.
 *
 * ## What sits above this class
 *
 * Task 15 (the Socket.io gateway) implements the *same* `DomainEventPublisher`
 * seam, for `publish`, and one token resolves to one provider. So the token is
 * bound to neither implementation but to
 * `reservations/composite-domain-event.publisher.ts`, which forwards `publish`
 * and `notifyPromotions` to both — each call in its own `try`, because a
 * Socket.io write and an outbound HTTP call have unrelated failure modes and
 * must not be able to suppress one another.
 *
 * The composite's delegate list is built by injecting the concrete classes, so
 * the instance behind the seam is still the one **this** module built — the
 * guarantee `useExisting` used to provide, and the reason it matters is
 * {@link inFlight}: a second instance would drain an empty set while a real
 * notification was still in the air. `slack.module.spec.ts` asserts the
 * identity end-to-end.
 */

import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { DomainEvent, WaitlistPromotionNotice } from '../reservations/reservation-events';
import { DomainEventPublisher } from '../reservations/reservation-events';
import { GracefulShutdownService } from '../shutdown/graceful-shutdown.service';
import { SlackNotificationService } from './slack-notification.service';

@Injectable()
export class SlackDomainEventPublisher extends DomainEventPublisher {
  /** Detached notifications currently in flight, so shutdown can wait for them. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly notifications: SlackNotificationService,
    @InjectPinoLogger(SlackDomainEventPublisher.name) private readonly logger: PinoLogger,
    gracefulShutdown: GracefulShutdownService
  ) {
    super();
    // Same shape as `ScheduledJobRunner.drain` — registered in the
    // constructor, not `onModuleInit`, so a closer can never be forgotten.
    gracefulShutdown.registerCloser('slack-notifications', () => this.drain());
  }

  publish(events: readonly DomainEvent[]): void {
    for (const event of events) {
      if (event.name !== 'reservation:cancelled') {
        continue;
      }
      const { date, parkingSpotId, reservationId } = event.payload;
      this.detach('spot-freed', () =>
        this.notifications.notifySpotFreed({ parkingSpotId, date, reservationId })
      );
    }
  }

  notifyPromotions(notices: readonly WaitlistPromotionNotice[]): void {
    for (const notice of notices) {
      this.detach('waitlist-promoted', () => this.notifications.notifyWaitlistPromotion(notice));
    }
  }

  /**
   * Runs a notification without awaiting it, and without letting it escape —
   * but still tracked in {@link inFlight}, so shutdown can wait for it.
   *
   * The catch below is not only for "a bug in this application": every method
   * of `SlackNotificationService` does an unguarded Prisma read before it ever
   * reaches `SlackClient` (which itself never throws), so an ordinary database
   * hiccup is a real and expected way for `send()` to reject, not only a
   * theoretical one.
   */
  private detach(notification: string, send: () => Promise<unknown>): void {
    const running: Promise<void> = send()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.error({ err: error, notification }, 'Slack notification threw unexpectedly');
      })
      .finally(() => {
        this.inFlight.delete(running);
      });
    this.inFlight.add(running);
  }

  /**
   * Waits for every detached notification currently in flight. Called from
   * the shutdown closer registered in the constructor; never throws, because
   * every promise in {@link inFlight} already ends in `.catch`.
   */
  private async drain(): Promise<void> {
    if (this.inFlight.size === 0) {
      return;
    }
    this.logger.info(
      { count: this.inFlight.size },
      'Waiting for detached Slack notifications to finish'
    );
    await Promise.all([...this.inFlight]);
  }
}
