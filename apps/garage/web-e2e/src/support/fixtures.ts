/**
 * Per-persona pages, for the specs that need more than one person at a time.
 *
 * Three of the six scenarios are about two people disagreeing — a cell lock
 * seen from the other side, a queue promoted when somebody else cancels, an
 * admin acting on a reservation that is not theirs — and none of them can be
 * written with a single browser context. These fixtures give each persona its
 * own context (its own cookie jar, its own socket), built from the
 * `storageState` the `setup` project produced.
 *
 * A fixture is only constructed when a test names it, so a spec that needs one
 * person pays for one browser.
 */

import { test as base, type Browser, type Page } from '@playwright/test';
import { ADMIN, USER, USER_TWO, storageStatePath, type Persona } from './personas';
import { recordDayRoomSubscriptions } from './realtime';

export interface PersonaPages {
  /** Signed in as the seeded admin (`Dev Admin`). */
  readonly adminPage: Page;
  /** Signed in as the seeded ordinary user (`Dev User`). */
  readonly userPage: Page;
  /** Signed in as the second ordinary user (`Dev User Two`). */
  readonly userTwoPage: Page;
}

async function pageFor(
  browser: Browser,
  persona: Persona,
  use: (page: Page) => Promise<void>
): Promise<void> {
  const context = await browser.newContext({ storageState: storageStatePath(persona) });
  const page = await context.newPage();
  // Attached here, before the page has navigated anywhere, because the thing it
  // records happens as soon as the socket connects and a listener added later
  // would have missed it — and `await`ed for the same reason, since under
  // `E2E_TRACE_REALTIME` it registers an init script. A few event handlers on an
  // otherwise idle page; see `realtime.ts` for what they are for.
  await recordDayRoomSubscriptions(page, persona.key);
  try {
    await use(page);
  } finally {
    await context.close();
  }
}

export const test = base.extend<PersonaPages>({
  adminPage: async ({ browser }, use) => {
    await pageFor(browser, ADMIN, use);
  },
  userPage: async ({ browser }, use) => {
    await pageFor(browser, USER, use);
  },
  userTwoPage: async ({ browser }, use) => {
    await pageFor(browser, USER_TWO, use);
  },
});

export { expect } from '@playwright/test';
