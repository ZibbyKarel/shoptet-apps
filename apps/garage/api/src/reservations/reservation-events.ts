/**
 * The **after-commit** seam: what Tasks 15 (Socket.io) and 16 (Slack) will fill
 * in, and the shape this task hands them.
 *
 * ## Why this exists as an interface with a no-op default
 *
 * `plan.md` and the Task 13 brief are explicit that the reservation transaction
 * must be minimal — **no Slack call and no broadcast inside it**. That is not a
 * style preference. Both are network calls, and a network call inside an open
 * transaction holds `FOR UPDATE` locks on the waitlist rows of a spot for as
 * long as the remote end takes to answer, which turns a slow Slack API into a
 * parking lot nobody can cancel out of.
 *
 * The rule is enforced structurally rather than by comment: the services never
 * call a publisher from inside `$transaction`. The transaction callback
 * *returns* the events it would like emitted, and the caller emits them after
 * `await` has resolved — i.e. after `COMMIT`.
 * `reservations.db.spec.ts` ("the after-commit seam") proves the ordering by
 * having the publisher read the database **on a second connection** and assert
 * the promoted reservation is already visible there, which is only true
 * post-commit.
 *
 * ## Why the payloads are the realtime contract's own
 *
 * `@garage/contract/realtime` already declares every server → client payload
 * (`reservation:created`, `reservation:cancelled`, `reservation:reassigned`,
 * `waitlist:updated`) as a Zod schema, and global constraint 1 says no event may
 * exist in code before it exists in the contract. So this file declares no
 * payload of its own: {@link DomainEvent} is a mapped type over the contract's
 * `ServerToClientEvents`, which means an event added to the contract becomes
 * expressible here for free, and an event *not* in the contract does not compile.
 *
 * Note in particular what the contract already decided for us: one committed
 * transaction produces exactly **one** event. A cancellation that promoted
 * somebody emits `reservation:reassigned` **instead of** `reservation:cancelled`,
 * never both — see the schema comments in `libs/garage/contract/src/realtime/events.ts`.
 * A `waitlist:updated` may accompany it, because that is a different cell fact
 * (the queue length) rather than a second story about the same one.
 */

import type { ServerToClientEvents } from '@garage/contract/realtime';

/**
 * One committed, already-persisted fact, ready to be broadcast.
 *
 * A discriminated union over the contract's event map, so `name` narrows
 * `payload`. Task 15's gateway can therefore forward one with
 * `io.to(roomForDate(payload.date)).emit(name, payload)` and nothing else.
 */
export type DomainEvent = {
  [K in keyof ServerToClientEvents]: {
    name: K;
    payload: Parameters<ServerToClientEvents[K]>[0];
  };
}[keyof ServerToClientEvents];

/**
 * A user who should be told, out of band, that something happened *to* them
 * rather than merely near them.
 *
 * Only promotion qualifies today: it is the one outcome a user did not ask for
 * and would otherwise discover by refreshing the page. Task 16 turns this into
 * an outbound `chat.postMessage`; there are deliberately no slash commands and
 * no interactive Block Kit (global constraint 8).
 */
export interface WaitlistPromotionNotice {
  /** Who was promoted. */
  userId: string;
  parkingSpotId: string;
  /** The freed day, `YYYY-MM-DD` in Europe/Prague. */
  date: string;
  /** The reservation they now hold. */
  reservationId: string;
}

/**
 * Where committed facts go.
 *
 * Implementations must not throw and must not block: they are called after the
 * transaction has committed, on the request's way out, and a failure to
 * broadcast must never turn a successful cancellation into an error the user
 * sees. {@link NoopDomainEventPublisher} was what got registered before any
 * real subscriber existed. There are now two implementations — Task 15's
 * Socket.io broadcast and Task 16's outbound Slack notification — and one token
 * resolves to one provider, so `reservations.module.ts` binds it to
 * `CompositeDomainEventPublisher`, which forwards to both with each call in its
 * own `try`. Nothing registers the no-op below any more.
 *
 * The "must not throw" clause above is not advice to implementors so much as
 * the composite's specification: it is the class that has to hold the line when
 * an implementation breaks the promise anyway.
 */
export abstract class DomainEventPublisher {
  /** Broadcast committed facts into their day rooms. Never called inside a transaction. */
  abstract publish(events: readonly DomainEvent[]): void;

  /** Notify promoted users out of band. Never called inside a transaction. */
  abstract notifyPromotions(notices: readonly WaitlistPromotionNotice[]): void;
}

/**
 * The historical default: events are computed, typed and validated by the
 * compiler, and then dropped. No longer registered anywhere as of Task 16 (see
 * the class comment above) — kept rather than deleted because it costs nothing
 * to keep and is the obvious fallback for a future module that needs
 * `DomainEventPublisher` wired but has nothing to send events to yet (e.g. a
 * narrow unit test, or a deployment with both Task 15 and Task 16 disabled).
 *
 * Deliberately silent rather than logging: an `info` line per reservation with
 * no subscriber listening would be pure noise. What makes this safe to forget
 * is the parity between this class and the contract's event map, which the
 * compiler checks regardless of whether anything is bound to it.
 */
export class NoopDomainEventPublisher extends DomainEventPublisher {
  publish(): void {
    // Intentionally empty — see the class comment.
  }

  notifyPromotions(): void {
    // Intentionally empty — see the class comment.
  }
}
