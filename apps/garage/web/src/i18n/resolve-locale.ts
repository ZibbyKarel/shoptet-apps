/**
 * The locale for one request, read on the server.
 *
 * Split out of `app/layout.tsx` so the rule can be tested without rendering a
 * document, and so the two sources it reads — the cookie the switcher writes
 * and the header the browser sends — are named in one place. The decision
 * itself is `negotiateLocale` in `libs/shared/i18n`, which is shared with the client
 * error boundary.
 *
 * `cookies()`/`headers()` make the caller dynamic. The root layout already
 * awaits `auth()`, so nothing is being given up here.
 */

import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, negotiateLocale, type Locale } from '@garage/i18n';

export async function resolveRequestLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  return negotiateLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });
}
