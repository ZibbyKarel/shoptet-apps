# 0302 – The locale is a cookie, not a URL segment

**Date:** 2026-09-09 · **Status:** accepted · **Task:** `TODO.md` item 9 ·
**Relates to:** `doc/decision/0298-urls-are-english-because-a-url-is-an-identifier.md`,
`doc/decision/0303-message-catalogs-live-in-the-app-not-in-libs-i18n.md`

## What

The application ships two locales, `cs` and `en` (`LOCALES` in
`libs/shared/i18n/src/lib/locale.ts`), and **no URL says which one you are reading**.
Every route this app serves is the same path in both languages: `/`, `/admin`,
`/login`, `/settings`.

The locale for one request is decided in `apps/garage/web/src/app/layout.tsx`, through
`apps/garage/web/src/i18n/resolve-locale.ts`, from exactly two inputs:

1. the `NEXT_LOCALE` cookie (`LOCALE_COOKIE`), if its value is a shipped
   locale — an explicit choice the visitor made, so it wins outright;
2. otherwise `Accept-Language`, read in quality order: Czech **or Slovak**
   means `cs`, any other named language means `en`, and a header that is
   absent, wildcard-only or malformed falls through to `DEFAULT_LOCALE`
   (`cs`).

The decision function is `negotiateLocale` in `libs/shared/i18n`, deliberately free of
`next-intl` so the client error boundary (`apps/garage/web/src/app/global-error.tsx`,
which has no layout above it and reads `navigator.language`) can reach the same
answer without an intl runtime.

What this decision rules **out**, and none of it exists in the tree:

- no `app/[locale]/…` segment and no locale prefix on any path;
- no `next-intl` middleware and no `next-intl` Next.js plugin;
- no `i18n/request.ts` / `getRequestConfig` (see `doc/i18n.md` for why the
  server entry point is not needed even with two locales).

The switcher is two radio-style entries in the user-avatar menu
(`apps/garage/web/src/shell/top-bar/top-bar.tsx`, under a `nav.language` header). It
writes the cookie client-side and re-renders the route:

```ts
document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
router.refresh();
```

`apps/garage/web/src/shell/top-bar/use-locale-switch.ts`. `path=/` because the choice
is the whole app's, a year because a returning visitor should keep their
language, `SameSite=Lax` because the value must survive the redirect back from
Okta, **no `Secure`** because local development is served over plain HTTP, and
the value is lowercase because `isLocale` is case-sensitive by design. It is
`document.cookie` rather than a server action: one string of per-visitor UI
state with nothing to authorize does not earn a round trip before the refresh
that already round-trips.

## Why

**1. `apps/garage/web-e2e` asserts concrete paths, and a prefix would move all of
them.** The browser suite navigates and asserts `/`, `/login`, `/settings` and
`/admin` by name, through `apps/garage/web-e2e/src/support/*`; `libs/garage/auth`'s
`signInPath` must name the exact segment the App Router serves the login page
under or Auth.js 404s; `proxy.ts`'s matcher is a regex over path segments.
`0298` had just settled what those segments are spelled like. A `[locale]`
prefix would rewrite that whole surface for a benefit — a shareable
per-language link — that nobody asked for in an internal app behind Okta.

**2. Two independent claims on the path shape in one sprint is how both get
botched.** `TODO.md` item 7 is separately going to put the selected day in the
URL. A locale prefix and a date parameter landing in the same window, each
rewriting the same route table and the same e2e page objects, is a merge
conflict dressed up as a feature. The cookie takes nothing from item 7.

**3. Reading a cookie costs nothing that was not already spent.** The root
layout is already dynamic: it `await auth()`s before it renders anything, so
this app has no statically prerendered document to protect. `cookies()` and
`headers()` in `resolve-locale.ts` therefore change no rendering mode and add
no request the layout was not already making. The usual argument _for_ a URL
segment — that it keeps a route static and cacheable at the edge — does not
apply to a route that was never static.

The `NEXT_LOCALE` name is `next-intl`'s own convention, kept even though no
next-intl middleware runs: if one is ever added, it will look exactly there.

## Consequences and residuals

- **A language is not shareable by link.** Sending a colleague a URL sends
  them the page, not the language; they see it in whatever their own cookie or
  browser says. Accepted: this is an internal app whose readers are two
  language groups working from their own machines, not a public site with
  per-language SEO.
- **The switch is a `router.refresh()`, not a navigation.** The locale is
  resolved on the server, so the new language arrives with the refreshed
  server render — verified end to end in `apps/garage/web-e2e/src/locale.spec.ts`,
  which switches a `cs-CZ` browser to English and then asserts English copy
  after a `reload()` _and_ after a `goto('/settings')`, while every request
  header still says `cs-CZ`.
- **A visitor with cookies disabled gets header negotiation only**, on every
  page load. That degrades to the correct default rather than to a broken UI.
- **The cookie carries no `Secure` flag.** It holds a two-letter language tag
  and nothing else; the trade is deliberate, so that local plain-HTTP
  development behaves like production.

## The upgrade path, if shareable per-language URLs are ever wanted

`next-intl`'s own routing is the mechanism: `defineRouting` with a locale
prefix, its request interceptor composed into `apps/garage/web/src/proxy.ts` — which
already holds the session check, and which Next.js 16 named `proxy` rather than
`middleware` — `getRequestConfig` in `apps/garage/web/src/i18n/request.ts`, and the
route tree moved under `app/[locale]/`.
That change **must also** rewrite `apps/garage/web-e2e/src/support/*` and every
asserted path in the browser suite, and reconcile with whatever `TODO.md` item
7 did to the URL. It is one coherent change, and it is not this one — which is
the whole reason it is written down here rather than half-started.
