# 0121 – The window banner quotes a date only under `lockMode: 'AUTO'`

## What

The green/yellow banner above the lot has six variants, not the design's three:

| `state` | `lockMode` | message |
| --- | --- | --- |
| `OPEN` | `AUTO` | `Rezervace na září jsou otevřené — zapisovat lze do 31. srpna.` |
| `OPEN` | forced | `Rezervace na září jsou otevřené.` |
| `LOCKED` | any | `… jsou uzamčené. Jako admin …` / `… Novou rezervaci už nezaložíte …` |
| `NOT_YET_OPEN` | `AUTO` | `Rezervace na září se zatím neotevřely — otevřou se 25. srpna.` |
| `NOT_YET_OPEN` | forced | `Rezervace na září se zatím neotevřely.` |

The two dated sentences interpolate `windowTo` / `windowFrom`; the other four
never mention a date.

## Why

### The date is only true under `AUTO`

`monthWindowOverviewSchema` is explicit, and it is the schema's own prose:

> `windowFrom` / `windowTo` are always the inclusive bounds the **AUTO** rule
> would produce. They are reported even when `lockMode` overrides the state, so
> the UI can explain what the automatic rule would have done — but that only
> works if the UI can tell the two situations apart, which is why `lockMode`
> travels with them.
>
> `lockMode !== 'AUTO'` means `state` was **overridden by an admin**, and
> `windowFrom`/`windowTo` are therefore hypothetical. Rendering
> "otevře se 25. 12." from them in that case would be a false statement.

The design computes its date arithmetically (`new Date(y, m, 0)`) and has no
notion of an override reaching the banner, so it quotes the date
unconditionally. Under `FORCE_OPEN` that produces "zapisovat lze do 31. srpna"
for a month that is open *because an admin said so* and will stay open past
that date. That is a sentence the user would act on and it would be wrong.

### `NOT_YET_OPEN` needs its own sentence

The design's window predicate is a boolean (`monthOpen()`), so the design can
only draw "open" or "locked". The contract's `MonthLockState` has three
members, and the difference is not cosmetic — `libs/shared/i18n` already words the two
error codes apart on purpose:

> `OUT_OF_HORIZON` and `RESERVATIONS_LOCKED` are worded to read as different
> situations on purpose: the first says the window has not opened *yet*, the
> second says it has already closed. Collapsing them to the same sentence would
> defeat the reason the contract has two codes at all.

The banner collapsing them would defeat it in the more visible place. The admin
screen (`05-admin-window.png`) already labels the third state "Zatím
neotevřeno", so the vocabulary is the design's even though this banner variant
is not.

## Consequences

- Six message keys where the design implies three. All six live in
  `libs/shared/i18n`'s `lot` namespace, keyed off `state` and `lockMode`.
- `toBannerView` is a pure function returning `{ tone, messageKey, values }`
  rather than a formatted string, so the branch table is testable without a
  DOM. `values` always carries all three placeholders — `month`, `until`,
  `from`, the last two empty for the undated keys — so the call site's argument
  shape does not vary with the key.
- `NOT_YET_OPEN` under a forced mode is unreachable through today's
  `monthLockState` (`FORCE_OPEN → OPEN`, `FORCE_LOCKED → LOCKED`). It is still
  implemented and tested, because the *schema* permits the combination and a
  screen must render what arrives, not what it believes can arrive.

## Verified by

`apps/garage/web/src/lot/lot-view.spec.ts`, §`toBannerView` — six tests, one per row
of the table above. Mutating `toBannerView` to drop the `isAuto` guard and
always interpolate the dates fails 2 tests by name
("never quotes a date when an admin forced the state", "drops the opening date
from NOT_YET_OPEN under an override too").
