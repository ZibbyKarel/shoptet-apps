/**
 * The single place client components attach to next-intl.
 *
 * The locale and the catalog are **inputs**, not constants. They are resolved
 * once per request in `apps/garage/web/src/app/layout.tsx` — which reads the
 * `NEXT_LOCALE` cookie and the `Accept-Language` header (see
 * `./locale.ts`) — and handed down through `apps/garage/web/src/app/providers.tsx`.
 *
 * This lib deliberately does not import the catalogs. They live in
 * `apps/garage/web/messages/*.json` (`TODO.md` item 9), and `libs/shared/i18n` is
 * `scope:web`: an Nx lib cannot import from an app. The dependency is
 * therefore inverted — the app supplies the messages, the lib supplies the
 * runtime. See `doc/decision/0303-*`.
 *
 * The time zone stays fixed: reservation days are Europe/Prague calendar days
 * regardless of the reader's language (`plan.md`, `doc/decision/0014-*`).
 */

import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { PRAGUE_TIME_ZONE } from '@garage/shared-types';
import type { Locale } from './locale';

/**
 * A message catalog as it comes out of JSON: nested namespaces of ICU strings.
 *
 * Structural rather than `next-intl`'s exported `AbstractIntlMessages`: this
 * type crosses into `apps/garage/web`'s props, and a wrapper lib that re-exported the
 * wrapped package's type would put `next-intl` back in the app's type surface —
 * the thing the wrapper rule exists to prevent. The provider only passes the
 * object through, and the *keys* are typechecked at the call sites through the
 * `AppConfig["Messages"]` augmentation in `apps/garage/web/next-intl.d.ts`.
 */
export type AppMessages = Record<string, unknown>;

export interface IntlProviderProps {
  readonly children: ReactNode;
  /** Resolved per request; never guessed inside a component. */
  readonly locale: Locale;
  /** The catalog for {@link IntlProviderProps.locale}. */
  readonly messages: AppMessages;
  /** Overridable for tests only; production callers omit it. */
  readonly now?: Date;
}

/** Wraps `children` with this application's next-intl configuration. */
export function IntlProvider({ children, locale, messages, now }: IntlProviderProps) {
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone={PRAGUE_TIME_ZONE}
      messages={messages}
      // `exactOptionalPropertyTypes` forbids passing an explicit `now={undefined}` —
      // `next-intl`'s `now` prop is typed `Date`, not `Date | undefined`.
      {...(now === undefined ? {} : { now })}
    >
      {children}
    </NextIntlClientProvider>
  );
}
