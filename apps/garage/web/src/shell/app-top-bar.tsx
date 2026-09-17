'use client';

/**
 * `TopBar`, connected to the session and the profile.
 *
 * The whole file is the wiring: which two sources the name and email come
 * from, where the role comes from, and what the two menu actions do. Every
 * *rule* lives in `./top-bar/top-bar.tsx`, which is why this one is three expressions
 * long and has no branches of its own.
 *
 * ## Why the session guard lives here
 *
 * `useRequireAuth` is what recovers from a session that ends **while the tab
 * is open** — the user signing out in another tab, or the Okta refresh
 * failing. `apps/garage/web/src/app/(app)/layout.tsx` renders this component
 * unconditionally for all three signed-in routes, so calling it here is the
 * one place that covers every one of them, `/` included.
 *
 * It used to be called only by `shell/settings-page.tsx` and the four admin
 * panels — never by `/`, the screen the product exists for and the one a tab
 * is left open on. The consequence was not a missing redirect but a dead end:
 * `lot-screen.tsx` and `use-current-user.ts` both gate their queries on
 * `status === 'authenticated'`, a disabled TanStack query stays `pending`
 * forever, and the screen therefore rendered "Načítá se…" with no redirect,
 * no `signIn()` and no message. `/admin` was no better — `AdminScreen`
 * early-returns while the profile is pending, so the panels that *do* call
 * `useRequireAuth` were never mounted in exactly the states that need it.
 * See `doc/decision/0255-*`.
 *
 * The proxy (`src/proxy.ts`) still refuses the *navigation*; this is the other
 * half, and the two do not overlap.
 */

import { useRouter } from 'next/navigation';
import { signOut, useRequireAuth } from '@garage/auth/client';
import { DEFAULT_LOCALE, isLocale, useLocale } from '@garage/i18n';
import { LOGIN_ROUTE } from '../routes';
import { TopBar } from './top-bar/top-bar';
import { useLocaleSwitch } from './top-bar/use-locale-switch';
import { useCurrentUser } from './use-current-user';

export function AppTopBar() {
  const router = useRouter();
  // Both the read and the guard: `useRequireAuth` wraps `useSession` and
  // returns the same session, so there is no second subscription and no way
  // for a caller to take the read without the guard.
  const { session } = useRequireAuth();
  const { data: profile } = useCurrentUser();
  // `useLocale()` is typed as a bare string — `AppConfig["Locale"]` is
  // deliberately not augmented (`apps/garage/web/next-intl.d.ts`), so the narrowing
  // happens here rather than by asserting.
  const contextLocale = useLocale();
  const locale = isLocale(contextLocale) ? contextLocale : DEFAULT_LOCALE;
  const switchLocale = useLocaleSwitch();

  // The profile is authoritative once it arrives; until then the session's own
  // claims keep the bar from rendering an empty pill. Both can be absent on the
  // very first paint, which is what the fallbacks are for.
  return (
    <TopBar
      name={profile?.name ?? session?.user?.name ?? ''}
      email={profile?.email ?? session?.user?.email ?? ''}
      role={profile?.role}
      onNavigate={(route) => router.push(route)}
      // `redirectTo` rather than letting Auth.js fall back to the current URL:
      // the current URL is a protected screen, so the proxy would bounce the
      // now-signed-out visitor to the login page anyway — one navigation
      // instead of two, and no flash of a screen they can no longer read.
      onSignOut={() => void signOut({ redirectTo: LOGIN_ROUTE })}
      locale={locale}
      onLocaleChange={switchLocale}
    />
  );
}
