/**
 * Signing in, for real.
 *
 * This spec starts **signed out**, because it is the one that exercises the
 * thing every other spec takes for granted: an unauthenticated visitor is
 * bounced to the sign-in screen, the
 * button there hands them to the OIDC issuer, and the code that comes back is
 * exchanged for a session that authenticates against the API.
 *
 * The last step is the one worth naming. Landing on `/` proves only that Auth.js
 * set a cookie. The parking grid is drawn from `overview.day`, which the API
 * answers over a bearer token and refuses with 401 without one — so asserting
 * that a spot tile is on screen is what proves the *access token* works, not
 * just the session.
 */

import { expect, test } from '@playwright/test';
import { SESSION_COOKIE, recordAuthTraffic } from './support/auth-network-log';
import { LOGIN_PATH, LOT_PATH, SIGN_IN_BUTTON, issuerOrigin } from './support/oidc-login';
import { USER } from './support/personas';

// Signed out: the point of this file.
//
// It is not an *override*, and the difference is worth stating so nobody
// deletes it as redundant or trusts it as a defence. Nothing gives this file a
// session to override: neither the `chromium` project nor the root `use:` block
// sets `storageState`, and the personas are applied per browser context in
// `support/fixtures.ts` — whose `test` this file deliberately does not import,
// taking the bare one from `@playwright/test` instead. This line pins the empty
// state explicitly, so that the day a persona *is* hoisted into `use:` the spec
// about signing in does not quietly start out signed in.
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * The sign-in screen's URL — with the `?callbackUrl=…` Auth.js appends when it
 * is the one doing the redirecting, and without it when the sign-out handler
 * navigates there directly. Both are the same screen; anchoring the pattern to
 * the end of the *path* rather than of the URL is what accepts both.
 */
const LOGIN_URL_PATTERN = new RegExp(`${LOGIN_PATH}(\\?|$)`, 'u');

test('an unauthenticated visitor is sent to the sign-in screen', async ({ page }) => {
  await page.goto(LOT_PATH);

  await expect(page).toHaveURL(LOGIN_URL_PATTERN);
  await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible();
  // The lot is not merely hidden behind a redirect — none of it rendered.
  await expect(page.getByRole('region', { name: 'Skupina IT' })).toHaveCount(0);
});

test('the OKTA button starts an authorization-code flow at the issuer', async ({ page }) => {
  await page.goto(LOGIN_PATH);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();

  await page.waitForURL(`${issuerOrigin()}/**`);

  // Not any redirect: an OIDC authorization request, with the parameters the
  // application is configured to send. `code_challenge` is the one that cannot
  // be faked into place — it is PKCE, and Auth.js derives it per attempt.
  const authorize = new URL(page.url());
  expect(authorize.searchParams.get('response_type')).toBe('code');
  expect(authorize.searchParams.get('redirect_uri')).toContain('/api/auth/callback/okta');
  expect(authorize.searchParams.get('scope')).toContain('email');
  expect(authorize.searchParams.get('code_challenge')).not.toBeNull();
  expect(authorize.searchParams.get('state')).not.toBeNull();
});

test('a completed sign-in yields a session the API accepts', async ({ page }) => {
  await page.goto(LOGIN_PATH);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await page.waitForURL(`${issuerOrigin()}/**`);

  await page.locator('input[name="username"]').fill(USER.subject);
  await page.locator('textarea[name="claims"]').fill(JSON.stringify(USER.claims));
  await page.getByRole('button', { name: 'Sign-in' }).click();

  await page.waitForURL(LOT_PATH);
  await expect(page.getByRole('button', { name: 'Uživatelské menu' })).toContainText(
    USER.displayName
  );
  // Drawn from `overview.day`, which is bearer-token-only. Without a working
  // access token this is a 401 and the screen shows an error instead.
  await expect(page.getByRole('region', { name: 'Skupina IT' })).toBeVisible();
});

/**
 * Sign-out, through the menu, as a person does it.
 *
 * **History, because it explains the shape of this test.** It used to fail about
 * once in ten full-suite runs and was deliberately left red: sign-out was not
 * durable under load, and the second assertion below was the only thing
 * reporting it. That defect is fixed (`doc/decision/0230-*`) — sign-out now
 * revokes the session server-side, so a cookie that survives the clear is
 * refused and deleted on its next use.
 *
 * The diagnosis is worth keeping because the obvious reading was wrong. It was
 * not a concurrent `/api/auth/session` re-installing the cookie — that endpoint
 * is never called on the sign-out path at all. Every render that reads the
 * session re-issues the cookie, so the clear was racing the framework's own RSC
 * prefetches.
 *
 * This test still races, which is exactly why it cannot be the only one: it can
 * only catch a regression by luck, at whatever rate the machine happens to
 * produce. *"a session cookie kept from before sign-out is refused afterwards"*
 * below asserts the same property deterministically and is the one to read first
 * when this area breaks. Keep both. Do not retry, relax or `fixme` this one —
 * `doc/decision/0189-*` records why each of those is a way of not knowing.
 */
test('signing out returns to the sign-in screen and the lot is protected again', async ({
  page,
}) => {
  recordAuthTraffic(page, 'signout');
  await page.goto(LOGIN_PATH);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await page.waitForURL(`${issuerOrigin()}/**`);
  await page.locator('input[name="username"]').fill(USER.subject);
  await page.locator('textarea[name="claims"]').fill(JSON.stringify(USER.claims));
  await page.getByRole('button', { name: 'Sign-in' }).click();
  await page.waitForURL(LOT_PATH);

  await page.getByRole('button', { name: 'Uživatelské menu' }).click();
  await page.getByRole('menuitem', { name: 'Odhlásit se' }).click();

  await expect(page).toHaveURL(LOGIN_URL_PATTERN);
  await page.goto(LOT_PATH);
  await expect(page).toHaveURL(LOGIN_URL_PATTERN);
});

/**
 * The property the test above can only catch by luck, asserted directly.
 *
 * The race in `0189` ends with a valid session cookie back in the jar after a
 * completed sign-out. Whether it gets there by a render finishing late or by
 * somebody copying the cookie out of a browser makes no difference to what
 * follows: a session token that outlives its sign-out must not still work.
 *
 * So this reproduces the *outcome* rather than the timing — take the cookie
 * while signed in, sign out for real through the menu, put it back — and asserts
 * that the application refuses it. Deterministic, no load required, and it fails
 * on cookie-deletion-only sign-out every single time.
 *
 * The cookie value is moved inside the browser context and is never written to
 * a log, a trace or any other artifact.
 */
test('a session cookie kept from before sign-out is refused afterwards', async ({
  page,
  context,
}) => {
  await page.goto(LOGIN_PATH);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await page.waitForURL(`${issuerOrigin()}/**`);
  await page.locator('input[name="username"]').fill(USER.subject);
  await page.locator('textarea[name="claims"]').fill(JSON.stringify(USER.claims));
  await page.getByRole('button', { name: 'Sign-in' }).click();
  await page.waitForURL(LOT_PATH);

  const kept = (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE);
  // Asserted, not assumed: if the cookie were named something else this test
  // would otherwise "pass" having restored nothing at all.
  expect(kept, `no ${SESSION_COOKIE} cookie was set by a completed sign-in`).toBeDefined();

  await page.getByRole('button', { name: 'Uživatelské menu' }).click();
  await page.getByRole('menuitem', { name: 'Odhlásit se' }).click();
  await expect(page).toHaveURL(LOGIN_URL_PATTERN);

  // Exactly what the race achieves: the deleted cookie is back, unexpired and
  // structurally valid. Nothing re-authenticated — there is no trip to the
  // issuer here.
  await context.addCookies([kept as NonNullable<typeof kept>]);

  await page.goto(LOT_PATH);
  await expect(page).toHaveURL(LOGIN_URL_PATTERN);
  // And not merely redirected: none of the protected screen rendered.
  await expect(page.getByRole('region', { name: 'Skupina IT' })).toHaveCount(0);
});
