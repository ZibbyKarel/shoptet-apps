# Over-engineering audit — `libs/garage/*`

Part of [the 2026-09-24 audit](00-summary.md). Scope: `auth`, `calendar-export`,
`contract`, `database`, `realtime-client`, `shared-types` — all non-generated
source under each lib's `src/` (Prisma's `src/generated/**` is machine output,
out of scope). Correctness, security, and performance are out of scope for this
pass.

Every abstraction in this codebase carries a comment justifying it with a
measured failure mode or decision record, so the yield is small and mostly
"unused API surface," not structural over-engineering.

## Findings (ranked biggest-cut-first)

**delete** — Drop `startOfDayInPrague` and `endOfDayExclusiveInPrague`. No
replacement — grep across `apps/` and `libs/` shows zero callers outside their
own spec file (`prague-time.spec.ts`); every real Prague-boundary need in the
app goes through `todayInPrague`/`toDateOnlyInPrague` instead.
`libs/garage/shared-types/src/lib/prague-time.ts:95` and `:111`.

**delete** — Drop `isAfter`, `isSameDay`, `differenceInDays`. No replacement —
each is exercised only by `date-only.spec.ts`; no caller anywhere in `apps/` or
`libs/` uses them (`isBefore` and `dayOfWeek`, by contrast, do have one real
caller each and should stay).
`libs/garage/shared-types/src/lib/date-only.ts:190`, `:202`, `:206`, `:210`.

**yagni** — Drop `SignOutRegistry.size()`. No replacement — its own doc says
"For tests and diagnostics," and grep confirms the only callers are the four
assertions in `revocation.spec.ts`; nothing in `apps/garage/web` reads it.
`libs/garage/auth/src/lib/revocation.ts:93` (interface) and `:294` (impl).

## Lean already (inspected, nothing to cut)

- **`libs/garage/auth`** — every process-global map, the shared-refresh-state
  coalescing, and the sign-out registry are backed by a measured, cited bug
  (`doc/decision/0231-*`, `0051-*`, `0245-*`); none of it is speculative.
- **`libs/garage/calendar-export`** — a single pure wrapper function; nothing
  to cut.
- **`libs/garage/contract`** — the barrel exports are already curated
  (builders and internal schemas deliberately withheld from `@garage/contract`'s
  public surface); no single-consumer interfaces or dead procedures found.
- **`libs/garage/database`** — `createPrismaClient`, `assertDisposableDatabase`,
  `generateSeedIcsToken` are each one focused function with no unused
  parameters or config knobs.
- **`libs/garage/realtime-client`** — the cell-lock/timing/validation split is
  justified by real testability needs (pure functions extracted specifically
  to be spec'd without a socket); no needless layering.
- **`libs/garage/shared-types` remainder** (holidays, domain constants,
  reservation-window) — no unused exports, no config nobody sets.

## Net

**-~40 lines, -0 deps possible.**
