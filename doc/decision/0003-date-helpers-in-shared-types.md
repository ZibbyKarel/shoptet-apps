# 0003 – Europe/Prague date logic lives in `libs/garage/shared-types`, not `libs/shared/i18n`

**Date:** 2026-08-28 · **Status:** accepted

## What

Pure date-only logic for the Europe/Prague zone (today, day boundaries, the
reservation horizon, Czech public holidays, parsing/serializing `YYYY-MM-DD`) is
implemented in **`libs/garage/shared-types`**, already in Phase 1. `libs/shared/i18n` in Phase 4 only
re-exports it and adds next-intl-bound formatting (month names, day names, localized
labels).

## Why

`plan.md` places "the single implementation of Europe/Prague date logic" in `libs/shared/i18n`
(Phase 4), but earlier/parallel phases need it too:

- **Phase 1 (contract)** – validating the reservation horizon in Zod schemas.
- **Phase 5 (backend)** – "today" for the rule "only today and the future can be
  reserved", cron jobs in Europe/Prague.

Meanwhile the backend must not depend on `next-intl` (a frontend library). If the helper
stayed in `libs/shared/i18n`, either someone would duplicate it (violating "single
implementation"), or `apps/garage/api` would drag in next-intl.

`plan.md` itself introduces `libs/garage/shared-types` for "domain types/constants not directly
tied to the contract" and explicitly allows the helper to live "in `libs/shared/i18n` **or**
`libs/garage/shared-types`" (§Contract-first, date semantics) – this decision just fixes which
of the two options applies.

## How

- `libs/garage/shared-types` has no runtime dependency on next-intl or on Zod.
- Implemented with a native `Intl` / `Temporal`-free approach with an explicit
  `Europe/Prague` zone; no `new Date()` without a zone anywhere in domain logic.
- ESLint `no-restricted-imports` forbids importing `libs/shared/i18n` in `apps/garage/api`.
- `libs/shared/i18n` re-exports `libs/garage/shared-types`'s public API under the same names, so FE
  feature code keeps importing only `@myorg/i18n` (the wrapper rule still holds).

## Risk if this is wrong

If it turns out holidays/formatting belong elsewhere, the move is mechanical – it's one
lib with no dependencies, and the wrapper in `libs/shared/i18n` keeps the public API stable.
