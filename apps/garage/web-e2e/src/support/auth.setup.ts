/**
 * The `setup` project: sign each persona in once, cache the session.
 *
 * Playwright runs this before every other project (`dependencies: ['setup']` in
 * `playwright.config.mts`), and the specs then start from the resulting
 * `storageState` instead of walking the OIDC redirect chain three dozen times.
 *
 * The saved state is **produced by a real sign-in**, not assembled: each
 * `setup` below opens a fresh browser context and goes through
 * {@link signInThroughOidc}, so the cookie in the file is one Auth.js minted
 * from a code it exchanged with the issuer. Nothing is written into it by hand.
 *
 * It runs on **every** invocation rather than being cached across runs, which
 * is deliberate: an access token from a previous run may have expired, and a
 * suite that starts by refreshing a stale session is a suite whose first
 * failure is unrelated to what it tests.
 *
 * `login.spec.ts` is the one spec that does *not* use these files — it is about
 * the flow itself, so it starts signed out.
 */

import { test as setup } from '@playwright/test';
import { PERSONAS, storageStatePath } from './personas';
import { signInThroughOidc } from './oidc-login';

for (const persona of PERSONAS) {
  setup(`sign in as ${persona.key}`, async ({ page }) => {
    await signInThroughOidc(page, persona);
    await page.context().storageState({ path: storageStatePath(persona) });
  });
}
