# 0131 — Slack's Czech copy stays in `apps/garage/api/src/slack/`, and there is still no backend catalog

**Date:** 2026-09-03 · **Status:** accepted · **Task:** 16 ·
**Reconsiders:** `doc/decision/0082-*`

## What

The three Slack messages — the freed-spot notice, the promotion DM and the daily
summary — are Czech strings built by functions in
`apps/garage/api/src/slack/slack-messages.ts`. They are **not** entries in the
`libs/shared/i18n` catalog, and **no** second, backend-side message catalog was
created.

Dates in them are formatted with `Intl.DateTimeFormat('cs', …)` directly, not
with a hand-written Czech month table.

## Why this needed deciding at all

`doc/decision/0082-*` put the ICS feed's three Czech strings in
`libs/garage/calendar-export` because `libs/shared/i18n` is tagged `scope:web`, `apps/garage/api` is
`scope:api`, and `@nx/enforce-module-boundaries` refuses the dependency — for
good reason: `libs/shared/i18n` wraps `next-intl`, a React package with no place in a
Nest process. That record closed with an explicit instruction:

> If a second one appears (Slack notifications, Task 16), that is the moment to
> reconsider option 2 with two real call sites in view rather than one.

This is that reconsideration, with the second surface now real.

## The options, weighed with two surfaces in view

1. **Move `libs/shared/i18n` to `scope:shared`.** Still rejected, and for the same
   reason as in 0082, only stronger: it drags `next-intl` and its React peer
   into the backend's dependency graph. The boundary is not an accident.
2. **A backend-only catalog** (say `libs/backend-copy`, `scope:shared`, no
   dependencies) holding both the ICS strings and the Slack strings.
   **Rejected — after actually looking at the two sets.** They share not one
   word:

   | ICS (`libs/garage/calendar-export`) | Slack (`apps/garage/api/src/slack`) |
   | --- | --- |
   | `Parkování` (calendar name) | `Uvolnilo se parkovací místo …` |
   | `Parkování – E2.92` (event summary) | `Máte parkovací místo …` |
   | `Rezervované parkovací místo E2.92.` | `Parkování — … / Volná jsou 3 místa z 9: …` |

   A catalog whose entries have no consumer in common is a folder, not an
   abstraction. It would add a lib, a project graph edge and a tag to every
   review, and buy nothing that the two files do not already have — while making
   both surfaces harder to read, because the sentence would no longer sit next
   to the code that decides when to send it.

   The consistency argument for one catalog is real, but it is about *terms*,
   not storage: "parkovací místo" must not become "parkovací stání" in one
   place. That is a review concern, and both surfaces' specs assert their
   strings verbatim, so a drift is a failing test rather than a silent one.
3. **Keep each surface's copy next to its only consumer.** Chosen, consistent
   with 0082.

**This is not a licence to scatter Czech through `apps/garage/api`.** The rule stays as
0082 put it: backend-rendered user-facing copy lives with the one surface that
renders it, and a *third* surface is the moment to revisit again — by then the
sets may genuinely overlap, and the argument above would flip.

## Why dates are `Intl`, not a duplicated table

The one thing the two surfaces really could drift on is dates, and Czech months
decline: `25. srpna` (genitive, with a day) versus `srpen` (nominative, alone).
`libs/shared/i18n/src/lib/dates.ts` gets that from ICU via next-intl's
`createFormatter` — and measured it rather than assuming it.

`Intl.DateTimeFormat('cs', …)` is the *same ICU data* without the React
dependency, so `formatCzechFullDate` produces exactly what the lot screen shows
(`pondělí 28. září 2026`) with no month table to fall out of step. Copying a
list of month names into the backend would have been the actual duplication
worth avoiding, and this avoids it.

A `DateOnly` is formatted as a UTC-midnight `Date` with an explicit
`timeZone: 'UTC'` — the same construction, and the same reason, as
`libs/shared/i18n/src/lib/dates.ts`: the value is a calendar day, and a local `Date`
would render the wrong day on some hosts and on DST Sundays.

## Consequences

- Czech copy now lives in three places: `libs/shared/i18n` (the web UI),
  `libs/garage/calendar-export` (the ICS feed) and `apps/garage/api/src/slack` (Slack). Each
  has exactly one consumer.
- ESLint enforces nothing here — there is no rule that could distinguish "a
  Czech sentence with one backend consumer" from "a Czech sentence that should
  have been in the catalog". The constraint is this record plus review.
- Czech numeral agreement (`místo`/`místa`/`míst`, `čeká`/`čekají`) is
  implemented in `slack-messages.ts` and asserted as whole sentences in
  `slack-messages.spec.ts`. If a fourth surface needs it, *that* helper — not
  the sentences — is what should be lifted into a shared lib.

## How

- `apps/garage/api/src/slack/slack-messages.ts`, `slack-messages.spec.ts`.
- `apps/garage/api/src/slack/slack.db.spec.ts` — the strings survive the round trip
  through the real SDK's form encoding, diacritics intact.
