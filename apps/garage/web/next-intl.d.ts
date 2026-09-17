/**
 * Message keys are typechecked against the Czech catalog.
 *
 * next-intl 4 resolves `useTranslations`' namespace and key types from
 * `AppConfig["Messages"]` (`use-intl/core/AppConfig`), an interface that ships
 * empty and is populated by module augmentation. Pointing it at `cs.json` —
 * the source of truth for keys (`TODO.md` item 9) — makes a typo in a
 * namespace or a key a compile error, and makes a key that exists only in
 * `en.json` invisible to the type system. That asymmetry is intended; runtime
 * parity in the other direction is what `messages/messages.spec.ts` is for.
 *
 * `Locale` is deliberately *not* augmented: `Locale` is `libs/shared/i18n`'s to define
 * (`libs/shared/i18n/src/lib/locale.ts`), and declaring a second union here would give
 * the workspace two of them.
 *
 * **This is not an import of `next-intl`.** `declare module` is a type-level
 * augmentation, not an import declaration, so the wrapper rule
 * (`eslint.config.mjs`'s `no-restricted-imports`, `doc/i18n.md`) is untouched:
 * no value from the package is reachable from here, and there is nowhere else
 * this can live — `libs/shared/i18n` may not read `apps/garage/web/messages/cs.json`.
 */

import type csMessages from './messages/cs.json';

declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof csMessages;
  }
}
