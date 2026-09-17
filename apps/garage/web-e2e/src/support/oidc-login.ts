/**
 * Signing in the way a person does: the real OIDC authorization-code redirect.
 *
 * There is **no test path through authentication** in this repository, and this
 * file is where that promise is kept. It drives a browser through the exact
 * sequence production runs — the sign-in page's Server Action, Auth.js's
 * `/authorize` redirect with PKCE and `state`, the issuer's login form, the
 * callback at `/api/auth/callback/okta`, the code exchange, the session cookie
 * — and the only thing that differs from production is the value of
 * `AUTH_OKTA_ISSUER` (see `doc/decision/0009-*`, `doc/environment.md`). Nothing
 * here injects a token,
 * sets a cookie by hand, or asks the application to trust a header.
 *
 * The one thing it types that a real Okta login does not is the mock server's
 * *Optional claims JSON* field — because `mock-oauth2-server` issues no `email`
 * or `name` claim of its own, and the API needs both to provision a user it has
 * never seen. See `./personas.ts` and `doc/decision/0180-*`.
 */

import { expect, type Page } from '@playwright/test';
import type { Persona } from './personas';

/** The signed-out screen. Mirrors `LOGIN_ROUTE` in `apps/garage/web/src/routes.ts`. */
export const LOGIN_PATH = '/login';

/** The parking overview. Mirrors `LOT_ROUTE`. */
export const LOT_PATH = '/';

/** Accessible name of the one button on the sign-in screen (`login.signIn`). */
export const SIGN_IN_BUTTON = 'Login přes OKTA Verify';

/**
 * Origin of the OIDC issuer, derived from `AUTH_OKTA_ISSUER` so that the suite
 * cannot end up asserting against a different issuer than the app redirects to.
 * `http://localhost:8080/default` → `http://localhost:8080`.
 */
export function issuerOrigin(): string {
  const issuer = process.env['AUTH_OKTA_ISSUER'];
  if (issuer === undefined || issuer === '') {
    throw new Error('AUTH_OKTA_ISSUER is not set — the e2e suite cannot find the OIDC issuer.');
  }
  return new URL(issuer).origin;
}

/**
 * Completes the whole redirect flow and leaves the browser on the lot screen.
 *
 * Each step is awaited on a **URL**, not on a timeout: the issuer's form only
 * exists after Auth.js has issued its redirect, and the lot only renders after
 * the callback has exchanged the code.
 */
export async function signInThroughOidc(page: Page, persona: Persona): Promise<void> {
  await page.goto(LOGIN_PATH);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();

  // The issuer's own login form. Waiting for its origin (rather than for the
  // form's fields) is what proves the browser actually left the application.
  await page.waitForURL(`${issuerOrigin()}/**`);

  await page.locator('input[name="username"]').fill(persona.subject);
  await page.locator('textarea[name="claims"]').fill(JSON.stringify(persona.claims));
  await page.getByRole('button', { name: 'Sign-in' }).click();

  // A relative pattern; Playwright resolves it against `use.baseURL`.
  await page.waitForURL(LOT_PATH);
  // The top bar renders the name off the session, so this asserts the session
  // exists rather than merely that a redirect happened.
  await expect(page.getByRole('button', { name: 'Uživatelské menu' })).toContainText(
    persona.displayName
  );
}
