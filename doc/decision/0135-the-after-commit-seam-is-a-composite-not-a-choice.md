# 0135 — The after-commit seam is a composite, not a choice between Socket.io and Slack

**Status:** accepted
**Date:** 2026-09-03
**Context:** merging `task-16-slack-jobs` into `feat/lets-park-mvp` (Task 15 + Task 16)

## Context

`DomainEventPublisher` (`apps/garage/api/src/reservations/reservation-events.ts`) is
the after-commit seam Task 13 left: the reservation services compute events
inside the transaction, return them, and publish strictly after `COMMIT`,
outside the cancel retry loop.

Two tasks then implemented it, independently and in parallel:

- Task 15 bound the token in `RealtimeModule` to `RealtimeDomainEventPublisher`
  (Socket.io fan-out into day rooms).
- Task 16 bound the same token in `ReservationsModule` to
  `SlackDomainEventPublisher` with `useExisting` (outbound `chat.postMessage`).

Nest resolves one provider per token. Both authors saw the collision coming and
each left a comment saying so; neither could resolve it, because neither branch
could name the other's class.

## Decision

The token is bound to a new `CompositeDomainEventPublisher`
(`apps/garage/api/src/reservations/composite-domain-event.publisher.ts`), which fans
every fact out to a list of delegates. `RealtimeModule` and `SlackModule` each
provide and export their **concrete** publisher class; `ReservationsModule` —
the module that declares the token, and the only one that can name both
implementations — assembles the list and binds the composite.

Four properties, each of them load-bearing:

1. **Never throws, never blocks.** `reservation-events.ts` states the
   requirement: a broadcast failure "must never turn a successful cancellation
   into an error the user sees", because a user told their cancellation failed
   will cancel again, against a row that no longer exists. Every forward is
   wrapped and nothing is rethrown.
2. **No shared `try` between implementations.** A Socket.io write that throws
   must not suppress the Slack notification for the same event, and vice versa.
   Different transports, unrelated failure modes.
3. **No shared `try` between events.** A cancellation that promotes somebody
   publishes `reservation:reassigned` *and* `waitlist:updated` — two different
   facts about one cell — and one failing must not take the other with it. The
   loops are nested event-outer/delegate-inner, so each delegate is handed a
   one-element array and every innermost call is its own failure domain:
   `delegates.length × events.length` of them.
4. **Failures are logged, never returned.** `error` with the stack, naming the
   delegate class, the method and the event *name*. Never the payload, and
   therefore never a token or a JWT.
5. **A delegate cannot take the process down, whichever way it fails.** See
   below.

## A delegate must not be `async`, and what happens when one is

The seam's return type is `void` on purpose: a delegate must not make the
composite its async boundary. `SlackDomainEventPublisher` shows the expected
shape for a delegate with real asynchronous work — it detaches its own
promises, catches them itself, and holds them in an `inFlight` set registered as
a `GracefulShutdownService` closer, so `SIGTERM` waits for them. A delegate that
handed its promise to the composite instead would have work **nothing drains at
shutdown**.

`void` does not enforce this, and that turned out to matter. TypeScript's
void-return assignability rule lets a method returning `Promise<void>` satisfy
an abstract `publish(...): void`, so an `async` delegate *compiles* — the
abstract-class token, chosen so a replacement "cannot silently have the wrong
shape", does not catch this one. Measured on the first version of this class: a
rejecting async delegate's rejection was **not** caught by `forward`'s `try`,
and `apps/garage/api` installs no `unhandledRejection` handler, so under Node's default
it would terminate the API process — after `COMMIT`, on a user's cancellation
path. That is a strictly worse version of the outcome the whole seam exists to
prevent, and it would have arrived the first time someone added the obvious
third delegate (email, Teams) and wrote it `async` because its client is async.

`forward` therefore inspects what a delegate returns and routes a rejection to
the same log line as a synchronous throw. It does **not** await it: containing
the failure must not turn the seam into a blocking call. So the guarantee is "a
delegate cannot take the process down, whichever way it fails" — not "`async`
delegates are supported". Their work is still untracked at shutdown, and the log
line is how the author finds out.

Four tests pin this, and three mutants kill them: removing the thenable
handling, swallowing the rejection silently instead of logging it, and making
the composite await its delegates.

## Why a list of delegates rather than the two classes by name

The composite imports nothing from `realtime/` or `slack/`. That is what makes
it unit-testable against delegates whose only behaviour is to throw — the
`RecordingPublisher` in its spec — which matters because neither real
implementation throws today (the realtime one catches per event, the Slack one
detaches every promise). A composite tested only against the real two would be
unable to distinguish "the composite isolates its delegates" from "the delegates
happen not to fail", which is precisely the class of test this project keeps
finding: one that passes on a defence other than the one it names.

That isolation follows from taking a **list** through a **separate token**. It
does not follow from that token being a `Symbol`, and an earlier draft of this
record ran the two together. An abstract-class registry token would isolate the
composite identically. `DOMAIN_EVENT_PUBLISHERS` is a `Symbol` for one narrower
reason: the injected value is `readonly DomainEventPublisher[]`, and an array
cannot be a class. The convention it departs from is about the *seam*, and the
seam is untouched — `DomainEventPublisher` is still an abstract class, still
what the services inject, still bound with `useClass`. What the `Symbol` costs
is that the constructor parameter's type is an unchecked claim about what the
container holds; the factory's annotated return type checks the producing end
and two specs assert instance identity at the consuming end, which covers it
from both sides.

## Why the delegate list injects the classes rather than constructing them

Task 16 used `useExisting` deliberately: the Slack publisher must be the
instance `SlackModule` built. A second one would resolve, but would keep its own
`inFlight` set — so a `SIGTERM` would drain an empty set while a real
notification was still in the air — and could not reach the collaborators
`SlackModule` does not export. Injecting `SlackDomainEventPublisher` as a token
in the factory preserves that exactly; `slack.module.spec.ts` asserts the
identity through the composite rather than trusting this paragraph. The same
argument applies to `RealtimeDomainEventPublisher`, which needs the gateway
`RealtimeModule` owns.

## Consequences

- `RealtimeModule` no longer binds or exports the `DomainEventPublisher` token;
  it exports `RealtimeDomainEventPublisher`. `SlackModule` is unchanged.
- Two wiring assertions changed meaning rather than being deleted:
  `realtime.gateway.spec.ts` and `slack.module.spec.ts` each asserted
  `app.get(DomainEventPublisher)` was *their* implementation. Both now assert
  that the bound provider is the composite and that their implementation is
  among its delegates — the same fact ("the reservation services really reach
  me"), asserted through the shape that now delivers it.
- Adding a third implementation is one entry in the factory in
  `reservations.module.ts`; the composite does not change. It must not be
  `async` — see the section above for why the compiler will not stop you and
  what the composite does when you do it anyway.
- Ordering in the delegate list is delivery order, not precedence. Every
  delegate is called for every event regardless of what the ones before it did.

## Alternatives rejected

- **Pick one and bolt the other on.** A Slack call inside
  `RealtimeDomainEventPublisher` would put an outbound HTTP call and a socket
  write in the same method, and the only honest way to keep them from
  suppressing each other would be to write the composite's `try` structure
  inside a class that also has a transport of its own.
- **A second seam.** Two tokens would mean two call sites in every service, and
  the "strictly after `COMMIT`, outside the retry loop" guarantee would have to
  be re-argued at each of them.
- **`Promise.allSettled` over async delegates.** The seam is `void` by
  contract; making it async would put a Slack round trip on the user's
  cancellation path. `SlackDomainEventPublisher` already detaches and tracks its
  own promises for shutdown, which is the right place for that concern.
