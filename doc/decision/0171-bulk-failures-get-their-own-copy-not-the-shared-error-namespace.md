# 0171 – Bulk failures get their own Czech copy, one sentence per code

**Date:** 2026-09-03 · **Status:** accepted · **Affects:** `libs/shared/i18n`, `apps/garage/web/src/lot/bulk-*`
**Follows on from:** `doc/decision/0016-*`, `doc/decision/0090-*`

## What

A failed `reservation.previewBulk` / `reservation.confirmBulk` is rendered from the **`bulk`**
message namespace, not from the shared `errors` one. `toBulkErrorMessageKey` (in
`apps/garage/web/src/lot/bulk-modal/bulk-view.ts`) reads the contract code through `toContractError` and maps each of
the six codes the two procedures can produce onto its own key:

| code | key | says |
| --- | --- | --- |
| `PAST_DATE` | `errorPastDate` | a selected day is in the past — remove it |
| `OUT_OF_HORIZON` | `errorOutOfHorizon` | the month has not opened yet |
| `RESERVATIONS_LOCKED` | `errorLocked` | the month is already locked |
| `VALIDATION_FAILED` | `errorValidation` | the day list itself was refused |
| `CONFLICT` | `errorConflict` | **nothing was written** — generate the schedule again |
| `FORBIDDEN` | `errorForbidden` | not allowed |

Anything else — a transport failure, a 500, a code outside the closed enum, or a code belonging to
another procedure — falls to `errorUnknown`.

## Why

**`errors.VALIDATION_FAILED` is actively wrong here.** It reads *"Požadavek porušuje pravidlo
rezervací (např. víkend nebo svátek)."* — true of `reservation.create`, and never true of a bulk
request: `doc/decision/0090-*` makes a weekend a per-day fact inside a *successful* response
precisely so one Saturday cannot sink a batch. A bulk `VALIDATION_FAILED` means the day list was
empty or spanned two months. Reusing the shared sentence would tell the user something that did not
happen.

**`errors.CONFLICT` is not wrong but is far too weak.** *"Někdo jiný mezitím provedl stejnou
změnu"* does not answer the question a user of a 20-day batch actually has, which is *how much of
it went through*. The answer is "none of it" — `confirmBulk` is one transaction with no retry
(`doc/decision/0092-*`) — and the copy has to say so, or the user will assume a partial booking and
go looking for it.

**This is the defect shape, not a hypothetical.** A sibling branch shipped a screen whose only
reachable failure rendered a neighbouring flow's copy, with a spec asserting the wrong string as
correct — which locks it in, because the next reader sees a green test. Two tests here are written
against that shape specifically: one asserts every declared code gets a *distinct* key (a single
funnelled sentence fails it), and one asserts that a bulk `VALIDATION_FAILED` does **not** render
the shared weekend sentence.

**Why not extend the shared `errors` namespace instead.** Because the sentence genuinely depends on
which procedure raised the code. `errors.*` is keyed by code alone and read by `ScreenError` for
every screen; making its `VALIDATION_FAILED` bulk-aware would make it wrong for
`reservation.create`. One namespace per audience is the smaller change.

**Why the mapping is a lookup and not a `switch` over `ErrorCode`.** A total `switch` would force
the six codes these procedures declare to sit alongside six they cannot raise, and every one of
those six would need copy — copy describing a failure that cannot happen, which is
`doc/decision/0021-*`'s unreachable-member problem in a message catalog. The `Partial<Record<…>>`
plus a fallback says exactly what is known.

## How

- `libs/shared/i18n/src/lib/messages.ts` — the `bulk` namespace and `CzechBulkMessages`.
- `apps/garage/web/src/lot/bulk-modal/bulk-view.ts` — `BULK_ERROR_KEYS` and `toBulkErrorMessageKey`.
- `apps/garage/web/src/lot/bulk-modal/bulk-modal.tsx` — one `role="alert"` paragraph, rendered on whichever step the
  failure happened on; a failed confirmation deliberately leaves the user on the proposal, because
  there is no result to show.
- `bulk-view.spec.ts` builds every failure by driving a **real** `RPCLink` with a stubbed `fetch`
  (`apps/garage/web` may not import `@orpc/client`), the same technique `screen-state.spec.tsx` uses, so
  the mapping is tested against the transport's wire shape rather than the spec's idea of it.

## Risk

**Two catalogs can drift.** `errors.RESERVATIONS_LOCKED` and `bulk.errorLocked` say nearly the same
thing in slightly different words, and a future rewording could touch one and not the other. That is
the price of the audience split; the alternative was one sentence that is wrong for one of the two
audiences, which is worse.

**A seventh code added to either procedure will silently render `errorUnknown`.** The contract is
the place that would change, and nothing here fails when it does. Adding a code to
`previewBulkContract`/`confirmBulkContract` therefore means adding a row to `BULK_ERROR_KEYS` — the
`it.each` table in `bulk-view.spec.ts` is where a reader will notice.
