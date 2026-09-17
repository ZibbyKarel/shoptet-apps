# 0303 – Message catalogs live in the app, not in `libs/shared/i18n`

**Date:** 2026-09-09 · **Status:** accepted · **Task:** `TODO.md` item 9 ·
**Relates to:** `doc/decision/0029-documentation-is-english-ui-copy-stays-czech.md`,
`doc/decision/0302-the-locale-is-a-cookie-not-a-url-segment.md`

## What

The UI copy is two JSON files in the application:

```
apps/garage/web/messages/cs.json      280 keys, the source of truth
apps/garage/web/messages/en.json      the same 280 keys
apps/garage/web/messages/messages.spec.ts   the parity guard over both
```

`libs/shared/i18n` holds **no copy at all**. It kept `next-intl` — it is still the
only project in the workspace allowed to import the package — and gave up its
catalog: `libs/shared/i18n/src/lib/messages.ts` is deleted, and the lib's three
consumers of it became locale-parameterised.

| Before, in `libs/shared/i18n`                                                 | After                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `IntlProvider` with `locale="cs"` hard-set and `messages={csMessages}` | `IntlProvider` takes required `locale` and `messages` props |
| `translateErrorCode(code)`                                             | `createErrorTranslator(locale, messages)`                   |
| eight module-level `format*(…)` functions                              | `createDateFormatters(locale)` / `useDateFormatters()`      |

The app resolves the locale and loads the catalog once per request
(`apps/garage/web/src/app/layout.tsx` → `resolve-locale.ts`, `load-messages.ts`) and
hands both down through `apps/garage/web/src/app/providers.tsx` to `IntlProvider`.
The one Czech-only table `Intl` cannot produce, `MONTH_LOCATIVE_CS`, stays in
`libs/shared/i18n/src/lib/dates.ts`: it is not copy a translator writes, it is
linguistic data the formatter needs.

## Why it could not be otherwise

`TODO.md` item 9 puts the JSON in `apps/garage/web/messages`, which is also
`next-intl`'s own documented layout. That alone would be a preference. What
makes it structural is Nx: `libs/shared/i18n` is a library tagged `type:util`,
`scope:web`, and **a library may not import from an application**. So a lib
that owned the catalogs could keep them only by keeping them inside itself —
and then two things it must not decide become its business: which locales exist
in a given app, and what the copy says.

The dependency therefore inverted. The lib supplies the runtime, the app
supplies the messages. That is also the shape that makes a second locale
cheap: adding one is a JSON file, an entry in `LOCALES`, and a line in
`load-messages.ts`'s catalog map — no change in `libs/shared/i18n` at all.

This does not reopen `0029`. Interface language is still a product decision and
Czech is still the source it is written in; the app now also ships an English
rendering of it, key for key, for the colleagues who do not read Czech.

## Two consequences worth knowing

### `cs.json` is the source of truth for keys, through a type augmentation

`apps/garage/web/next-intl.d.ts` is the whole mechanism:

```ts
import type csMessages from "./messages/cs.json";

declare module "next-intl" {
  interface AppConfig {
    Messages: typeof csMessages;
  }
}
```

`next-intl` 4 resolves `useTranslations`' namespace and key types from
`AppConfig["Messages"]`, an interface that ships empty and is populated by
module augmentation. Pointing it at `cs.json` makes a typo in a namespace or a
key a compile error. **This was verified, not assumed:** a probe referencing a
bogus key fails to compile with TS2345, and the reported parameter type lists
`cs.json`'s keys — so a key that exists only in `en.json` is invisible to the
type system, and is a type error at any reference site rather than in the JSON.
That asymmetry is intended, and it is why `messages/messages.spec.ts` exists.

The file lives in `apps/garage/web` and not in the lib for the same Nx reason as
everything above: `libs/shared/i18n` may not read `apps/garage/web/messages/cs.json`. And
**a `declare module` is a type augmentation, not an import** — no value from
`next-intl` is reachable from that file — so the wrapper rule
(`no-restricted-imports` in the root `eslint.config.mjs`) is intact, which
`web:lint` confirms on every run.

### Two compile-time guarantees moved, and `messages.spec.ts` is where they now live

Both were given up deliberately, and neither was allowed to just evaporate:

1. `libs/shared/i18n/src/lib/errors.spec.ts` used to iterate the contract's
   `ERROR_CODES` against the real catalog. It cannot any more — that would be
   the lib→app import Nx forbids — so its fixture is now derived from
   `ERROR_CODES` itself and the coverage check there is **vacuous by
   construction**. The real check is `messages.spec.ts`' "translates every
   contract error code", which runs **per locale** against the real catalogs
   and the real contract import: strictly broader than what was lost, because
   the old one never saw English.
2. The deleted TypeScript catalog declared
   `interface CzechErrorMessages extends Record<ErrorCode, string>`, making
   "every contract error code has a Czech message" a _compile-time_
   guarantee. JSON has no interfaces. `messages.spec.ts` restores it with an
   inert assignment at the bottom of the file:

   ```ts
   const _check: Record<ErrorCode, string> = cs.errors;
   ```

   `tsc` fails it if `cs.errors` ever loses a key `ErrorCode` requires. It
   works because `apps/garage/web/tsconfig.spec.json` includes
   `messages/**/*.spec.ts` in the typecheck program — if that include is ever
   narrowed, this guarantee goes silently, which is the one thing to know
   before editing that file.

## How it is verified

- `apps/garage/web/messages/messages.spec.ts` — key parity in **both** directions, no
  empty message in any locale, ICU-argument parity per key, typographic
  apostrophes only, per-locale `ERROR_CODES` coverage,
  `OUT_OF_HORIZON` ≠ `RESERVATIONS_LOCKED`, and a "still Czech" check with an
  eight-entry reviewed allowlist. `doc/i18n.md` says what each check catches.
- `web:typecheck` covers the augmentation and the `_check` assignment;
  `web:lint` covers the wrapper rule.
- `libs/shared/i18n`'s own six suites now test the lib as a locale-parameterised
  runtime — formatters for both languages, the negotiation table, the
  translator factory reading the catalog it is handed.
