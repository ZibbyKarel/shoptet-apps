/**
 * One page, one socket.
 *
 * `libs/garage/realtime-client` says in its own file header that
 * `useRealtimeConnection` is called "exactly one call per app" and that no
 * feature "can accidentally open a second connection by rendering a component
 * twice". `connection.spec.tsx` pins that in jsdom. **This file pins it in the
 * application that ships**, which is a different claim: the number of sockets a
 * built Next.js page ends up holding depends on hydration, on the session
 * status the provider gates on, and on React's real commit behaviour — none of
 * which a component test exercises.
 *
 * It exists because the claim was measured wrong once. `doc/decision/0187-*`
 * counted WebSockets per Playwright `Page` and found "23 of 68 pages opened a
 * second socket — about one page in three", and recorded the cause as unknown.
 * A `Page` is not a document: six of this suite's pages reload or navigate a
 * second time, and a second document is *supposed* to open a second socket.
 * `doc/decision/0221-*` has the re-measurement. What was missing was a test that
 * asks the question at the level the answer lives at, and this is it: an init
 * script runs once per document, so the tally it keeps cannot span a
 * navigation.
 *
 * The assertion is deliberately made **after** real work rather than the
 * instant the page settles — a day walk, and an open editing form, which is the
 * exact window in which a second connection would cost something (the gateway
 * excludes the asking socket from its `cell:locked` broadcast, so a page with
 * two connections hears its own hold). A count taken before the app has done
 * anything would pass against a duplicate that had not appeared yet.
 */

import type { Page } from '@playwright/test';
import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import { expect, test } from './support/fixtures';
import { LOT_PATH } from './support/oidc-login';
import { closeDialog, goToDate, openSpot } from './support/lot-page';
import { installRealtimeSocketCounter, realtimeSocketsInDocument } from './support/realtime';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.realtimeConnection);

/**
 * A bay of this spec's own, on this spec's own day.
 *
 * Nothing here reserves anything, but opening the dialog **does** take an
 * editing hold, and a hold is the one piece of shared state a second spec on
 * the same bay would notice.
 */
const SPOT = 'E2.93';

/**
 * Blocks until the document currently loaded has opened its socket.
 *
 * The same generous budget `waitForDayRoom` carries, and for the same reason:
 * what is being waited for is a whole session coming up — `useSession`
 * resolving, `libs/garage/auth` handing over an access token, then the handshake.
 */
async function waitForFirstSocket(page: Page): Promise<void> {
  await expect
    .poll(() => realtimeSocketsInDocument(page), {
      timeout: 30_000,
      message: 'the loaded document never opened a realtime connection',
    })
    .toBeGreaterThanOrEqual(1);
}

test('a lot page holds exactly one realtime connection, before and after a reload', async ({
  userPage,
}) => {
  // Before the first navigation: an init script only applies to documents
  // created after it is added.
  await installRealtimeSocketCounter(userPage);

  await userPage.goto(LOT_PATH);
  await waitForFirstSocket(userPage);

  // Real traffic on that socket — every day step is a `day:unsubscribe` and a
  // `day:subscribe` — and then an open form, which is a `cell:lock` and the
  // renewal heartbeat behind it.
  await goToDate(userPage, DATE);
  await openSpot(userPage, SPOT);

  expect(await realtimeSocketsInDocument(userPage)).toBe(1);

  await closeDialog(userPage);
  await userPage.reload();

  // A reload is a new document, so its tally starts empty: this leg asserts the
  // *replacement* is single, not that the page never opened a second socket in
  // its life. The page-wide count is two here and always was — that is the
  // number `doc/decision/0187-*` mistook for a defect.
  await waitForFirstSocket(userPage);
  await goToDate(userPage, DATE);
  await openSpot(userPage, SPOT);

  expect(await realtimeSocketsInDocument(userPage)).toBe(1);
});
