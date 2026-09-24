# Over-engineering audit — `apps/garage/web/src/*`

Part of [the 2026-09-24 audit](00-summary.md). Scope: Next.js 16 frontend —
`app`, `i18n`, `lot`, `shell`, `testing`, plus a light pass over
`apps/garage/web-e2e` and `apps/garage/api-e2e` support code for the same
pattern (test scaffolding bloat). Correctness, security, and performance are
out of scope for this pass.

Areas specifically inspected: `screen-state.tsx`, `toast-provider.tsx`,
`admin-errors.ts`, `bulk-view.ts`/`bulk-modal.tsx`, `day-overview-cache.ts`,
`use-cell-locks.ts`, `use-lot-realtime.ts`, the admin panel/screen split, test
scaffolding (`testing/stub-api.ts`, `contract-failure.ts`, `fixtures.ts`,
`providers.tsx`), `calendar-grid.ts`, `date-picker-dialog.tsx`,
`lock-mode-choice.tsx`, and the largest e2e support files
(`web-e2e/src/support/realtime.ts`, etc.).

This codebase does not show the usual over-engineering signature. Every
"generic" abstraction checked (`ScreenDataGuard`, `useNotify`/`ToastProvider`,
`useAdminWriteError`, `calendar-grid.ts`) has verified multiple real call
sites, and the doc comments consistently cite the concrete duplication (e.g.
"written out twice, thirteen fields at a time", "nine restatements") that
motivated extracting each one — i.e. these are already the result of a prior
consolidation pass, not speculative scaffolding. The admin panel/screen split
is genuine wiring-vs-logic separation (each panel wires different
queries/mutations), not copy-pasted boilerplate. The e2e realtime support file,
while large, is justified by a documented flake investigation with three false
diagnoses ruled out before the real cause was found.

## Findings

**yagni (trivial)** — `LockModeChoice`'s generic `<TValue extends string>` —
only call site (`admin-window-screen.tsx:163`) always binds it to
`ReservationLockMode` from `@garage/contract`. Replace with
`LockModeOption<ReservationLockMode>` / a concrete union; no second
instantiation exists to justify the type parameter.
`apps/garage/web/src/shell/admin/lock-mode-choice/lock-mode-choice.tsx:32-44`.

No deletable dead code, hand-rolled stdlib reimplementations, or unused
speculative props/variants were found in `apps/garage/web/src/*` within the
areas inspected.

## Net

**-0 lines, -0 deps possible** (the one finding is a type-parameter
simplification, not a line-count win).
