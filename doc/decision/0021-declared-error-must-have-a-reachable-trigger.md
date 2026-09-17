# 0021 – A declared error must have a reachable trigger

## What

A procedure may declare a code in `.errors(...)` only if it **can genuinely
occur** and the client can do something about it. When the only conceivable
trigger is either (a) expressible structurally in the schema, or (b) an
internal state the client has no reaction to, the code gets **removed** from
the declaration and the rule moves to where it belongs.

Specifically, fixing findings N2 and N3 from the Task 4 review:

- **`admin.window.months`** no longer declares `VALIDATION_FAILED`. The
  range-length limit is now structural: `MAX_MONTH_WINDOW_SPAN = 24` in
  `libs/garage/shared-types`, plus a second `.refine()` on
  `listMonthWindowsInputSchema`.
- **`me.regenerateIcsToken`** no longer declares `CONFLICT`. A collision on the
  randomly generated token is handled by a **retry loop in the handler** (a
  commitment for Task 12), not surfaced as an error.

## Why

`doc/decision/0018-*` says returning an undeclared code is a bug. The opposite
direction is a bug too, just a quieter one: a declared code is part of the
procedure's public type, so the frontend must handle it, `libs/shared/i18n` must
carry Czech copy for it, and QA must invent a scenario for it. When that
scenario doesn't exist, you keep paying for dead code and a dead translation
indefinitely.

Both findings also had a second, more concrete reason:

- **N2 – a limit the client can't know about isn't a contract.** The original
  declaration described "a range longer than however many months can be
  computed at once", but no number appeared anywhere in the contract. The
  client could only learn the limit by having the server reject it. That's
  exactly what contract-first avoids — and the bulk reservation, two files
  over, already gets this right (`MAX_BULK_BOOKING_DAYS` as a `.max()` on the
  `dates` field).
- **N3 – "retry" is not an error state.** The only conceivable cause of
  `CONFLICT` on regenerating the ICS token is a unique constraint on a freshly
  generated random string. There's nothing to explain to the user and nothing
  they can do but try again — which the server can do itself, better, and
  without a network round trip.

Precedent: commit `b849875` removed an over-declaration from `overview.day` for
the same reason.

## How

`MAX_MONTH_WINDOW_SPAN` lives in
`libs/garage/shared-types/src/lib/domain-constants.ts` next to
`MAX_BULK_BOOKING_DAYS`, because it's a domain constant, not a schema detail —
Task 13 will reference it when paginating the admin table.

Computing the span is a local function, `monthSpan()`, in
`api/reservation-window.ts`. It deliberately did not go into `shared-types`:
that lib owns **daily** Europe/Prague logic, not computing the length of a
`YYYY-MM` range, and a single use case doesn't justify a shared helper. There
are two refinements, in this order — `from <= to` first, then the span —
so `monthSpan()` never receives a reversed range.

Tests: a range of exactly 24 months passes, 25 fails, and `2026-12`→`2027-01`
is two months, not thirteen (a test that it isn't computed lexicographically).

For Task 12 this creates a binding obligation: `regenerateIcsToken` generates
the token in a loop until the insert succeeds. If it turns out retrying isn't
enough, the code must be returned to the contract **first**, and only then may
the handler throw it — the order is never reversed.

## Risk

**Narrowing a declaration is a breaking change; widening it isn't.** If either
code turns out to be needed after all, adding it back changes the procedure's
type and affects clients. The risk is small, though: neither procedure has an
implementation yet (Task 12 and 13 respectively), so nothing breaks
retroactively, and the Task 4 review flagged both declarations as unlikely
independently of this fix.

**The specific number 24 is an estimate.** It's based on the admin table never
showing more than a year ahead and a year back. If that turns out to be too
small, growing the constant is a one-line change that doesn't break clients
(the limit only loosens). Shrinking it would be breaking — hence erring
generous.

**`monthSpan()` duplicates future calendar arithmetic.** Once there's a need
to compute month ranges in more than one place, it belongs in
`libs/garage/shared-types` next to `doc/decision/0013-calendar-arithmetic-and-single-timezone-boundary.md`; moving it there now would be
premature abstraction.
