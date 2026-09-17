/**
 * The session check that runs before a navigation reaches a page.
 *
 * `auth` doubles as Next.js's request interceptor: called with a `Request` it
 * reads the session, runs `callbacks.authorized` (`isAuthorized` in
 * `libs/garage/auth`) and, when that returns `false`, redirects to
 * `pages.signIn` — which is {@link LOGIN_ROUTE}, because `auth.ts` passed it as
 * `signInPath`. `doc/auth.md` §"The flow, end to end" draws this step.
 *
 * ## Why `proxy.ts` and not `middleware.ts`
 *
 * Next.js 16 renamed the file: `middleware` is deprecated in favour of `proxy`,
 * and the two differ in more than a name — **`proxy` runs on the Node.js
 * runtime and that is not configurable**, whereas `middleware` still runs on
 * the Edge runtime by default (verified against the Next.js 16 upgrade guide,
 * not from memory; see
 * `doc/decision/0100-the-session-check-lives-in-proxy-ts-on-the-node-runtime.md`).
 *
 * The runtime is the reason this matters here rather than a cosmetic rename.
 * `./auth.ts` reads `AUTH_SECRET` and the OAuth client secret from
 * `process.env`, and Next.js inlines `process.env.*` into an Edge bundle at
 * build time. On the Node.js runtime they stay what they are: values read from
 * the process environment at request time, never baked into an artifact.
 *
 * ## What is deliberately not matched
 *
 * - `/api/auth/*` — Auth.js's own endpoints. Guarding the sign-in callback with
 *   a session check would require being signed in to sign in.
 * - `/api/health` — an orchestrator's probe carries no session, so protecting
 *   it would report every healthy instance as dead. Same reasoning as the API's
 *   `@Public()` probes (`doc/auth.md` §Public routes).
 * - `_next/static`, `_next/image`, `favicon.ico` — assets, not navigations.
 *
 * The login route itself **is** matched, on purpose: Auth.js compares the
 * request path against `pages.signIn` and skips its own redirect when they are
 * equal (`handleAuth` in `next-auth/lib/index.js`), so there is no loop.
 */

export { auth as proxy } from './auth';

/**
 * Each exclusion is anchored to a path-segment boundary, which is not
 * cosmetic: a bare `api/auth` would also exempt `/api/authorised-users`, and a
 * bare `api/health` would also exempt `/api/healthcheck` — an exemption that
 * silently becomes a hole the first time somebody adds a route whose name
 * starts the same way. `proxy.spec.ts` pins both cases.
 */
export const config = {
  matcher: ['/((?!api/auth/|api/health(?:$|/)|_next/static|_next/image|favicon\\.ico).*)'],
};
