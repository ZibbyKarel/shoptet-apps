'use client';

/**
 * Persists a language choice and re-renders the route under it.
 *
 * A cookie plus `router.refresh()`, deliberately, rather than a locale path
 * segment: the root layout resolves the locale per request (see
 * `../../i18n/resolve-locale.ts`), `refresh()` re-runs it on the server, and
 * every URL in the application stays what it was — which is what keeps the
 * browser suite's asserted paths and backlog item 7's date-in-the-URL work
 * from colliding with this one.
 *
 * `document.cookie` rather than a server action: this is one string of
 * per-visitor UI state with nothing to authorize, and a server action would
 * mean a round trip before the refresh that already round-trips.
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE, type Locale } from '@garage/i18n';

/** A year: long enough that a returning visitor keeps their language, short enough to expire. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function useLocaleSwitch(): (locale: Locale) => void {
  const router = useRouter();

  return useCallback(
    (locale: Locale) => {
      // `SameSite=Lax` and no `Secure`: the value is a language, it must
      // survive the Okta redirect back into the app, and the app is served
      // over plain HTTP in local development.
      document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
      router.refresh();
    },
    [router]
  );
}
