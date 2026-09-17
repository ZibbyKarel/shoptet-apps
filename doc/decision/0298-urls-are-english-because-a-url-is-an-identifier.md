# 0298 – URLs are English, because a URL is an identifier

**Date:** 2026-09-04 · **Status:** accepted · **Relates to:**
`doc/decision/0029-documentation-is-english-ui-copy-stays-czech.md`

## What

Every route segment this application serves is spelled in English. Three were
Czech and are not any more:

| Constant in `apps/garage/web/src/routes.ts` | Was           | Is          |
| ------------------------------------ | ------------- | ----------- |
| `LOGIN_ROUTE`                        | `/prihlaseni` | `/login`    |
| `SETTINGS_ROUTE`                     | `/nastaveni`  | `/settings` |
| `ADMIN_ROUTE`                        | `/sprava`     | `/admin`    |

`LOT_ROUTE` (`/`), `AUTH_API_ROUTE_PREFIX`
(`/api/auth`, fixed by Auth.js and by the callback URL registered with Okta)
and `HEALTH_ROUTE` (`/api/health`) were already English and did not move.

Nothing the user reads changed. Every UI string in `apps/garage/web` is still Czech.

No redirect from the old paths was added: this is an internal application
behind Okta, with no external inbound links to preserve.

## Why

`0029` drew the line between two things and it drew it correctly:
documentation is English because engineers and agents read it, and UI copy is
Czech because Czech employees read it. A URL sat awkwardly on that line, and
`routes.ts` used to resolve the ambiguity the other way, in a comment that
said "Paths are Czech because they are user-visible, the same reason UI copy
is".

That reading has been retired by the user's decision: **a URL is a
code-related identifier**, of a piece with file names, exported constants and
commit messages, all of which this project already writes in English. It is
addressed by page objects, matchers, redirect configuration and deployment
routing far more often than it is read off a screen by an employee, and each
of those readers is working in English.

The practical argument points the same way. `apps/garage/web-e2e/src/support/*`
addresses these paths by name; `libs/garage/auth`'s `signInPath` must name the exact
segment the App Router serves it under (`apps/garage/web/src/app/login/`), or
Auth.js's configured sign-in page 404s; `proxy.ts`'s matcher is a regex over
path segments. A mixed-language path table makes every one of those harder to
read for no benefit to the person reserving a parking spot, who arrives by
clicking a link.

This does not reopen `0029`. Interface language is a product decision and it
has not changed: the app renders in Czech.

## How it is verified

`npm run build`'s route table for `apps/garage/web` lists `/`, `/admin`, `/login` and
`/settings` — the four routes this application serves, spelled the way this
record says they should be. `web-e2e:e2e` is 21 passed: the eight spec files
and their support setup drive the browser against those exact paths (sign-in
redirects to `/login`, the settings modal is reached at `/settings`, the admin
tabs at `/admin`), so the page objects in `apps/garage/web-e2e/src/support/*` and the
routes they navigate to are the same thing, not two lists that happen to agree
today.

## Consequences and residuals

- **No redirect exists from the old Czech paths.** A bookmark or a saved link
  to `/prihlaseni`, `/nastaveni` or `/sprava` now 404s instead of resolving.
  Accepted per "What", above: this is an internal application behind Okta,
  with no external inbound links to preserve, and no evidence any employee
  bookmarked a URL rather than the app's own nav.
- **Any Okta-side configuration that names an old path by string would now be
  wrong.** The callback URL itself is `/api/auth/callback/okta`, which did not
  move, but if a redirect allow-list entry or a bookmarked admin link inside
  Okta's own console names `/prihlaseni` specifically, it needs updating by
  hand — this record does not reach outside the repository.
