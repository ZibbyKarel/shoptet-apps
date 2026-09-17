# 0100 – The session check lives in `proxy.ts`, on the Node runtime

## What

`apps/garage/web/src/proxy.ts` re-exports Auth.js's `auth` as the app's request
interceptor and lists, in a single matcher, the paths it does **not** run on:

```ts
export { auth as proxy } from './auth';

export const config = {
  matcher: ['/((?!api/auth/|api/health(?:$|/)|_next/static|_next/image|favicon\\.ico).*)'],
};
```

There is no `middleware.ts`, and no `runtime` export.

## Why

- **Next.js 16 renamed the file.** `middleware.ts` is deprecated; the
  convention is `proxy.ts` exporting `proxy`. This is not cosmetic — the rename
  came with the runtime change below.
- **The proxy runs on the Node.js runtime, and that is not configurable.**
  Which is exactly what this app needs. Auth.js's `auth` decrypts the session
  cookie with `AUTH_SECRET`; on the old edge runtime that secret had to be
  reachable from an edge bundle, which is the sort of arrangement that quietly
  turns into "the secret is in the bundle". On Node it is a plain
  `process.env` read in a server process.
- **One matcher, expressed as exclusions, is the readable direction.** The
  alternative — listing every protected path — fails open: a route added later
  and forgotten is unprotected, and nothing complains. Listing the *public*
  paths fails closed, which is the correct default for an app where every real
  screen requires a session.
- **The exclusions are anchored to segment boundaries.** `api/auth/` with the
  trailing slash, `api/health(?:$|/)`, and an escaped `favicon\.ico`. A bare
  `api/auth` also exempts `/api/authorised-users`; a bare `api/health` also
  exempts `/api/healthcheck`. Neither hole announces itself — the app keeps
  working, it just stops checking sessions on two paths nobody looks at. This
  was caught by the spec, not by review.
- **The login page is deliberately matched.** Auth.js compares the request path
  against `pages.signIn` and skips its own redirect when they are equal, so a
  matched login route cannot loop; excluding it would only mean the "already
  signed in, go to the app" redirect had to be duplicated somewhere else.

## How

- `signInPath` in `createAuth()` and the matcher both read `LOGIN_ROUTE` from
  `apps/garage/web/src/routes.ts`, so the redirect target and the protected set cannot
  drift into a loop.
- `proxy.spec.ts` reconstructs the compiled regex and pins each intent: the
  four protected paths, the six exempt ones, and — the point of the file —
  `/api/authorised-users`, `/api/healthcheck` and `/_next-door` staying
  protected.
- The live behaviour was measured against a running server rather than
  inferred from the pattern: `GET /` and `/settings` answered 307 to
  `/login`, `/api/health` answered 200, `/api/auth/session` answered 200,
  and `/api/healthcheck` answered 307. See the Task 23 report.

## Risk

- **The spec reproduces `path-to-regexp`'s compilation rather than invoking
  it.** For the single-group pattern used here that compilation is a mechanical
  `^…$` wrapping, and the live run above is what actually confirms it — but a
  future matcher using a different syntax would need the live check again,
  because the spec's `matches()` would silently model the wrong thing.
- **A session cookie is not a validated token.** The proxy answers "is there a
  session", nothing more; every authorisation decision belongs to the API,
  which validates the JWT against Okta's JWKS. A proxy that appeared to
  authorise would be a much worse thing than one that only redirects.
