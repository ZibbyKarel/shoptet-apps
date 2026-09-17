import { config } from './proxy';
import { AUTH_API_ROUTE_PREFIX, HEALTH_ROUTE, LOGIN_ROUTE } from './routes';

/**
 * Which paths the session check runs on.
 *
 * Getting this wrong has two distinct, silent failure modes: matching
 * `/api/auth/*` makes signing in require being signed in, and matching
 * `/api/health` reports every healthy instance as dead. Neither shows up as an
 * error anywhere — the first looks like "Okta is broken", the second like "the
 * deployment is down".
 *
 * The matcher is a path pattern that Next.js compiles with `path-to-regexp`.
 * For the single-group form used here, that compilation is a mechanical
 * `^…$` wrapping of the pattern, which is what `matches` below reproduces —
 * so this file pins the *intent* precisely and the live behaviour is confirmed
 * separately, by driving a running server (see the task report).
 */

const [matcher] = config.matcher;

function matches(pathname: string): boolean {
  return new RegExp(`^${matcher}$`).test(pathname);
}

describe('proxy matcher', () => {
  it('has exactly one pattern, so there is one rule to read', () => {
    expect(config.matcher).toHaveLength(1);
  });

  it.each([
    ['the parking overview', '/'],
    ['the settings screen', '/settings'],
    ['the administration screen', '/admin'],
    ['an unknown path', '/whatever'],
  ])('protects %s (%s)', (_label, pathname) => {
    expect(matches(pathname)).toBe(true);
  });

  it('protects the login page too — Auth.js skips its own redirect there', () => {
    // `handleAuth` compares the request path against `pages.signIn` and only
    // redirects when they differ, so matching this path cannot loop.
    expect(matches(LOGIN_ROUTE)).toBe(true);
  });

  it.each([
    ['the Auth.js callback', `${AUTH_API_ROUTE_PREFIX}/callback/okta`],
    ['the Auth.js session endpoint', `${AUTH_API_ROUTE_PREFIX}/session`],
    ['the Auth.js sign-in endpoint', `${AUTH_API_ROUTE_PREFIX}/signin/okta`],
    ['the readiness probe', HEALTH_ROUTE],
    ['static chunks', '/_next/static/chunks/main.js'],
    ['optimised images', '/_next/image'],
    ['the favicon', '/favicon.ico'],
  ])('leaves %s alone (%s)', (_label, pathname) => {
    expect(matches(pathname)).toBe(false);
  });

  it('still protects a route that merely starts like an excluded one', () => {
    // The exclusions are anchored to a segment boundary. Without that,
    // `/api/authorised-users` and `/api/healthcheck` would be exempt from the
    // session check by accident — an unauthenticated hole nobody wrote.
    expect(matches('/api/authorised-users')).toBe(true);
    expect(matches('/api/healthcheck')).toBe(true);
    expect(matches('/api/other')).toBe(true);
    expect(matches('/_next-door')).toBe(true);
  });
});
