/**
 * The after-commit seam with **two** implementations behind it.
 *
 * Task 15 (Socket.io) and Task 16 (Slack) both need the one
 * `DomainEventPublisher` token, and both said so in a comment predicting this
 * file. Nest resolves one
 * provider per token, so the resolution is not a choice between them: it is a
 * composite that forwards every fact to each implementation in turn. Neither
 * branch could write it, because neither could name the other's class — which
 * is why it lives here, next to the token it implements, rather than in
 * `realtime/` or `slack/`.
 *
 * ## Why it takes a list rather than the two classes
 *
 * The delegates arrive as a **list**, through a token of their own
 * ({@link DOMAIN_EVENT_PUBLISHERS}), assembled in `reservations.module.ts` from
 * the instances `RealtimeModule` and `SlackModule` export. Two consequences,
 * both deliberate:
 *
 * - This file imports nothing from `realtime/` or `slack/`, so the composite
 *   is unit-testable against delegates that do nothing but fail — which is
 *   the only way to prove the isolation properties below rather than assert
 *   them in prose. That follows from taking a list through a *separate* token;
 *   it has nothing to do with that token being a `Symbol` (see the token's own
 *   comment for why it is one).
 * - The instances are the ones their own modules built. Task 16 needed
 *   `useExisting` for exactly that reason (a second `SlackDomainEventPublisher`
 *   would resolve but could not reach the collaborators `SlackModule` does not
 *   export, and would keep its own in-flight set); injecting the concrete
 *   classes as tokens keeps that guarantee, and
 *   `slack.module.spec.ts` still proves the sharing end-to-end.
 *
 * ## The two isolation properties, and why the nesting is what it is
 *
 * `reservation-events.ts` states the requirement this class exists to keep:
 * implementations "must not throw and must not block: they are called after
 * the transaction has committed, on the request's way out, and a failure to
 * broadcast must never turn a successful cancellation into an error the user
 * sees". A user whose reservation *was* cancelled but who is told it failed
 * will cancel it again, against a row that no longer exists. So every forward
 * is wrapped, and nothing here ever rethrows.
 *
 * The loops are nested **event-outer, delegate-inner**, and each innermost call
 * gets its own `try`. That is `delegates.length × events.length` separate
 * failure domains, which is what the two requirements together demand:
 *
 * - *No shared `try` between implementations.* A Socket.io write that throws
 *   must not suppress the Slack notification for the same event, and vice
 *   versa — they are different transports with unrelated failure modes.
 * - *No shared `try` between events.* A cancellation that promoted somebody
 *   publishes `reservation:reassigned` **and** `waitlist:updated`, two
 *   different facts about the cell, and one failing must not take the other
 *   with it. `RealtimeDomainEventPublisher` already loops per event internally;
 *   doing it here as well means the property holds for *any* delegate, present
 *   or future, rather than depending on each one remembering to.
 *
 * Each delegate is therefore handed a one-element array. Both current
 * implementations loop over their argument and are indifferent to the batching;
 * a delegate for which it mattered would be a delegate that had quietly taken
 * on the batch-failure semantics this class is here to deny it.
 *
 * ## A delegate must not be `async` — and what happens if one is
 *
 * The seam's return type is `void` deliberately: a delegate must not make this
 * class its async boundary. `SlackDomainEventPublisher` shows the shape a
 * delegate with real asynchronous work is expected to use — it detaches its own
 * promises, catches them itself, and holds them in an `inFlight` set registered
 * as a `GracefulShutdownService` closer, so a `SIGTERM` waits for them. A
 * delegate that instead returned its promise to this class would have work that
 * **nothing drains at shutdown**, which is why `void` is the contract rather
 * than a formality.
 *
 * `void` does not *enforce* it, though, and that is the load-bearing part.
 * TypeScript's void-return assignability rule lets a method returning
 * `Promise<void>` satisfy an abstract `publish(...): void`, so an `async`
 * delegate **compiles** — the abstract-class token, chosen so a replacement
 * "cannot silently have the wrong shape", does not catch this one. An escaping
 * rejection would be worse than an escaping throw: `apps/garage/api` installs no
 * `unhandledRejection` handler, so under Node's default it would terminate the
 * process, after `COMMIT`, on a user's cancellation path — a strictly worse
 * version of the outcome this class exists to prevent.
 *
 * So {@link CompositeDomainEventPublisher.forward} inspects what a delegate
 * returns and routes a rejection to the same log line as a synchronous throw.
 * It does **not** await it: containing the failure must not turn the seam into
 * a blocking call. The guarantee is therefore "a delegate cannot take the
 * process down, whichever way it fails", not "an `async` delegate is
 * supported" — its work is still untracked at shutdown, and the log line is how
 * you find out you wrote one.
 *
 * ## What is logged
 *
 * A failure here is a logged defect and nothing more: `error` with the stack,
 * naming the delegate, the method and the event, and never the payload. There
 * is no caller who can trigger it at will — reaching it means a publisher that
 * promised not to fail did — and per the project's logging rule no token and
 * no JWT can appear in that line, because none of the fields is one.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { DomainEvent, WaitlistPromotionNotice } from './reservation-events';
import { DomainEventPublisher } from './reservation-events';

/**
 * The implementations {@link CompositeDomainEventPublisher} fans out to, in
 * order. Bound in `reservations.module.ts`.
 *
 * A `Symbol` rather than an abstract class for one reason only: the injected
 * value is `readonly DomainEventPublisher[]`, and an array cannot be a class.
 * The convention this departs from is about the *seam*, and the seam is
 * untouched — {@link DomainEventPublisher} is still an abstract class, still
 * what the services inject. Wrapping the list in a registry class purely to
 * satisfy the letter of the convention would add an indirection and check
 * nothing the factory's annotated return type does not already check at the
 * producing end, with `realtime.gateway.spec.ts` and `slack.module.spec.ts`
 * asserting instance identity at the consuming end.
 */
export const DOMAIN_EVENT_PUBLISHERS = Symbol('DOMAIN_EVENT_PUBLISHERS');

/**
 * What the `subject` log field says on the `notifyPromotions` path.
 *
 * Deliberately **not** shaped like a contract event name. On the `publish` path
 * `subject` holds a real `ServerToClientEvents` key (`reservation:cancelled`,
 * `waitlist:updated`, …); a promotion notice has no contract event, so a
 * `namespace:verb` literal here would send anyone who grepped the contract for
 * a name they saw in a log looking for something that does not exist.
 */
const PROMOTION_NOTICE_SUBJECT = 'waitlist promotion notice';

@Injectable()
export class CompositeDomainEventPublisher extends DomainEventPublisher {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHERS) private readonly delegates: readonly DomainEventPublisher[],
    @InjectPinoLogger(CompositeDomainEventPublisher.name) private readonly logger: PinoLogger
  ) {
    super();
  }

  publish(events: readonly DomainEvent[]): void {
    for (const event of events) {
      for (const delegate of this.delegates) {
        this.forward(delegate, 'publish', event.name, () => delegate.publish([event]));
      }
    }
  }

  notifyPromotions(notices: readonly WaitlistPromotionNotice[]): void {
    for (const notice of notices) {
      for (const delegate of this.delegates) {
        this.forward(delegate, 'notifyPromotions', PROMOTION_NOTICE_SUBJECT, () =>
          delegate.notifyPromotions([notice])
        );
      }
    }
  }

  /**
   * One forward, one failure domain. Never rethrows and never blocks: see the
   * class comment for why a broadcast failure must not reach the user who
   * already got their cancellation.
   *
   * `call` is typed `() => unknown` rather than `() => void` because a delegate
   * can return a promise **despite** the seam's `void` signature — see the
   * class comment's "an `async` delegate". The returned value is inspected at
   * runtime and its rejection routed to the same log line as a synchronous
   * throw; it is deliberately **not** awaited, because awaiting here would put
   * the delegate's transport back on the request's exit path.
   */
  private forward(
    delegate: DomainEventPublisher,
    method: 'publish' | 'notifyPromotions',
    subject: string,
    call: () => unknown
  ): void {
    try {
      const returned = call();
      if (isThenable(returned)) {
        void returned.then(undefined, (error: unknown) => {
          this.log(delegate, method, subject, error);
        });
      }
    } catch (error) {
      this.log(delegate, method, subject, error);
    }
  }

  /** The one log line a delegate failure produces, sync or async. */
  private log(
    delegate: DomainEventPublisher,
    method: 'publish' | 'notifyPromotions',
    subject: string,
    error: unknown
  ): void {
    this.logger.error(
      { err: error, publisher: delegate.constructor.name, method, subject },
      'An after-commit publisher failed; the other publishers were unaffected'
    );
  }
}

/**
 * Whether a value returned by a delegate is a promise we must attach a
 * rejection handler to.
 *
 * Structural rather than `instanceof Promise`: a delegate may return a
 * thenable from another realm or another promise library, and the failure this
 * guards against — an unhandled rejection terminating the process — is the same
 * either way.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
