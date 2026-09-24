# Over-engineering audit — 2026-09-24

Scope: `apps/garage/*` and `libs/*` (whole repo tree, generated Prisma output excluded).
Method: ponytail-audit — four parallel scans (`libs/garage`, `libs/shared`,
`apps/garage/api`, `apps/garage/web`), each verifying every "unused"/"single-caller"
claim by grepping the whole repo before reporting it.

Correctness, security, and performance are explicitly out of scope for this pass —
route those findings through a normal code review instead.

## Files in this audit

- [01-libs-garage.md](01-libs-garage.md) — `libs/garage/*`
- [02-libs-shared.md](02-libs-shared.md) — `libs/shared/*`
- [03-apps-garage-api.md](03-apps-garage-api.md) — `apps/garage/api/src/*`
- [04-apps-garage-web.md](04-apps-garage-web.md) — `apps/garage/web/src/*`

## Headline

The codebase is unusually disciplined for this kind of audit: most abstractions
carry an inline comment or decision-record citation defending the exact shape
they're in, and grepping confirmed most of those defenses hold (real multi-caller
use, a documented prior bug the abstraction prevents, etc.). The yield is small
and concentrated in **unused API surface** (dead exports, a couple of
single-implementation seams that anticipate a migration `plan.md` says isn't
happening) rather than structural over-engineering.

## All findings, ranked biggest-cut-first

1. **delete** — Unused `Tooltip` primitive (component + spec + stories), zero
   consumers anywhere. `libs/shared/design-system/src/primitives/lib/tooltip/tooltip.tsx`
   — **-554 lines**. See [02](02-libs-shared.md).
2. **shrink** — 9 RPC controllers repeat the identical one-line handler
   boilerplate ~20+ times (~630 lines total); a decorator/helper cuts most of
   it to one line per route. `apps/garage/api/src/*/*.controller.ts` —
   **~-60 lines**. See [03](03-apps-garage-api.md).
3. **yagni** — `LockService` abstract class with exactly one implementation
   and one caller, built for a Redis migration `plan.md` says is explicitly
   out of scope for the MVP. `apps/garage/api/src/realtime/lock.service.ts`.
   See [03](03-apps-garage-api.md).
4. **delete** — `NoopDomainEventPublisher` unused in production (nothing binds
   it), kept alive only by 4 spec files that could use an inline stub instead.
   `apps/garage/api/src/reservations/reservation-events.ts:101-122`. See
   [03](03-apps-garage-api.md).
5. **delete** — `startOfDayInPrague`/`endOfDayExclusiveInPrague`, no callers
   outside their own spec. `libs/garage/shared-types/src/lib/prague-time.ts`.
   See [01](01-libs-garage.md).
6. **delete** — `isAfter`/`isSameDay`/`differenceInDays` in `date-only.ts`, no
   callers outside their own spec. See [01](01-libs-garage.md).
7. **shrink** — `stub-api.ts` and `stub-transport.ts` duplicate the same
   fetch-stub body and `rpcPayload()` helper. `libs/shared/api-client/src/__fixtures__/`.
   See [02](02-libs-shared.md).
8. **yagni (minor)** — `FailureLogThrottle<TKind>` generic with one call site,
   one instantiation. `apps/garage/api/src/auth/failure-log-throttle.ts`. See
   [03](03-apps-garage-api.md).
9. **yagni (minor)** — `SignOutRegistry.size()`, only used by its own spec.
   `libs/garage/auth/src/lib/revocation.ts`. See [01](01-libs-garage.md).
10. **yagni (trivial)** — `LockModeChoice<TValue extends string>` generic with
    one call site, always instantiated with `ReservationLockMode`. `apps/garage/web/src/shell/admin/lock-mode-choice/lock-mode-choice.tsx`.
    See [04](04-apps-garage-web.md).

**Watch-list, no cut recommended:** several design-system primitives (`Radio`,
`Grid`, `Dropdown`, `Tabs`, `Switch`, `Checkbox`) each have only 1–2 real call
sites today — not waste yet, but worth reconsidering if their prop surfaces
grow past what that one caller needs. See [02](02-libs-shared.md).

## Net

**~-620 lines, -0 deps possible.**

Nothing here blocks a phase or needs discussion before cutting — items 1, 4, 5,
6, 9, 10 are pure deletions with no design decision attached. Item 2 (RPC
controller boilerplate) and item 3 (`LockService`) are the only two worth a
second look before touching, since one changes a repeated pattern across 9
files and the other removes a seam someone may have intended to keep for
later — confirm against `plan.md`'s single-instance stance first.
