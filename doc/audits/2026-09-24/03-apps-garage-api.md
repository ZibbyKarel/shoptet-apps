# Over-engineering audit — `apps/garage/api/src/*`

Part of [the 2026-09-24 audit](00-summary.md). Scope: NestJS backend modules
— app, audit, auth, calendar, common, database, health, logging, me, orpc,
overview, realtime, reservation-limits, reservation-window, reservations,
scheduling, shutdown, slack, spots, testing, users. Correctness, security, and
performance are out of scope for this pass.

This codebase is unusually disciplined: nearly every class carries a comment
defending why it exists in exactly this shape, and most of those defenses hold
up (concurrency-heavy booking domain, real dual implementations behind seams,
etc.). Findings below are the few spots where the stated justification doesn't
survive contact with the actual call graph.

## Findings (ranked biggest-cut-first)

**yagni** — Delete the `LockService` abstract-class + single-impl split; keep
just `InMemoryLockService`/a plain class. `plan.md` fixes single-instance as
the MVP target, Redis is explicitly "deliberately not implemented," and there
is exactly one caller (`RealtimeGateway`) and one implementation ever
instantiated — the seam has no second implementation to type-check against, so
the abstraction is pure speculation for a migration that isn't scheduled.
`apps/garage/api/src/realtime/lock.service.ts:138-183`,
`apps/garage/api/src/realtime/realtime.module.ts:44`.

**delete** — `NoopDomainEventPublisher` is dead in production (nothing binds
it anymore — the token resolves to `CompositeDomainEventPublisher`); its only
remaining callers are four spec files that could just use a two-line inline
stub or `jest.fn()`-based double instead of keeping a class in prod source
"because it costs nothing to keep."
`apps/garage/api/src/reservations/reservation-events.ts:101-122`.

**shrink** — 9 RPC controllers (`spots`, `users`, `me`, `reservations`,
`bulk-reservation`, `waitlist`, `reservation-window`, `reservation-limits`,
`overview`) each hand-write the identical per-route boilerplate —
`@Req() request, @Res() response, @CurrentUser() user): Promise<void> { return this.rpc.handle(request, response, user); }`
— repeated once per procedure, ~20+ times across ~630 lines. A small helper
(e.g. a method decorator that wraps a route in `this.rpc.handle`) would cut
most of that repetition to one line per route.
`apps/garage/api/src/*/*.controller.ts` (e.g.
`reservation-limits/reservation-limits.controller.ts:40-58`).

**yagni (minor)** — `FailureLogThrottle<TKind>` is a generic, independently-typed
class with exactly one call site (`JwksVerifierService`) and one instantiation
(`AuthFailureKind`). Not costly, but the generic parameter and injectable-clock
constructor buy nothing today; could be inlined as a private helper on the
class that uses it. `apps/garage/api/src/auth/failure-log-throttle.ts:51-78`.

## Lean already (inspected, nothing to cut)

The reservation/waitlist/bulk transaction machinery, the composite
domain-event publisher (genuinely 2 implementations), `ScheduledJobRunner`, the
Prisma error-mapping module, and the auth/JWKS pipeline all have real
multi-caller or multi-implementation justification and match `plan.md`'s
stated single-instance/no-broker constraints rather than contradicting them.

## Net

**-60 lines, -0 deps possible.**
