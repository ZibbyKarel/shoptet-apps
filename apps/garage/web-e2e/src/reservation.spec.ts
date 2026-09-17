/**
 * Creating a reservation, and giving it back.
 *
 * The whole round trip, through the UI a person uses: pick a day in the open
 * month, open a free bay, confirm, and see the car appear with the plate from
 * the user's own settings. Then cancel it and see the bay go back to "Volné".
 *
 * The day comes from `SPEC_DAY_SLOTS`, not from a literal: every spec books a
 * different business day of the next month so that two of them running at once
 * cannot collide on the one-reservation-per-user-per-day rule.
 */

import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import { expect, test } from './support/fixtures';
import { LOT_PATH } from './support/oidc-login';
import { USER } from './support/personas';
import {
  cancelReservation,
  expectFree,
  expectHeldBy,
  goToDate,
  openSpot,
  reserveSpot,
} from './support/lot-page';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.reservation);
const SPOT = 'E2.65';

// Serial, and stated rather than relied on: the three tests are three moments
// of one reservation's life, so the second and third have nothing to assert if
// the first did not happen. In serial mode Playwright skips the rest of the
// group after a failure instead of reporting three failures for one cause.
test.describe.configure({ mode: 'serial' });

test('a user reserves a free spot and the bay shows their name and plate', async ({ userPage }) => {
  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);

  // The month has to be genuinely open for this to mean anything. If it were
  // not, the tile would read "rezervace uzamčeny" and offer no CTA — so this
  // asserts the state the rest of the test depends on rather than assuming it.
  await expectFree(userPage, SPOT);

  await reserveSpot(userPage, SPOT);

  await expectHeldBy(userPage, SPOT, USER.displayName);
  // `2CD 5678` is `Dev User`'s seeded licence plate. It reaches the tile from
  // the *user's profile*, never from the reservation form — the modal has no
  // plate input, by contract (`spot-dialog.tsx`).
  await expectHeldBy(userPage, SPOT, '2CD 5678');
});

test('the reservation survives a fresh tab and a reload — it is in the database', async ({
  userPage,
}) => {
  // A different browser context from the one that booked it: no in-memory query
  // cache, no service worker, nothing carried over but the session cookie. The
  // bay can only be held here because the API says so.
  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await expectHeldBy(userPage, SPOT, USER.displayName);

  // And a literal reload on top, because the name promises one: this is the
  // cheaper, more familiar version of the same claim, and a reader who takes
  // the title at face value should find it in the body.
  await userPage.reload();
  await goToDate(userPage, DATE);
  await expectHeldBy(userPage, SPOT, USER.displayName);

  const dialog = await openSpot(userPage, SPOT);
  await expect(dialog).toContainText('Vaše rezervace');
});

test('the holder cancels it and the bay is free again', async ({ userPage }) => {
  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);

  await cancelReservation(userPage, SPOT);

  await expectFree(userPage, SPOT);
  await userPage.reload();
  await goToDate(userPage, DATE);
  await expectFree(userPage, SPOT);
});
