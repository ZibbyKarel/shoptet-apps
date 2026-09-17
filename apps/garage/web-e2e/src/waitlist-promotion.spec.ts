/**
 * Cancelling a reservation, and the queue behind it.
 *
 * Two people, two browser contexts. `Dev User` takes a bay; `Dev User Two`
 * queues for it and is told they are first in line; `Dev User` gives the bay
 * back. Nobody clicks anything to make the hand-over happen — the API promotes
 * the first eligible person in the queue inside the same transaction that
 * deletes the reservation (`WaitlistPromotionService`), and the test asserts
 * exactly that: after the cancel, the bay belongs to `Dev User Two` and their
 * queue entry is gone.
 *
 * The final assertion is made after a **reload**, deliberately. Promotion is a
 * backend guarantee; whether the news also arrives over the socket is what
 * `cell-lock.spec.ts` is for. Reloading is what keeps this test about the
 * promotion rather than about the broadcast — if it were asserted live, a
 * broken promotion and a broken broadcast would look identical.
 */

import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import { expect, test } from './support/fixtures';
import { LOT_PATH } from './support/oidc-login';
import { USER, USER_TWO } from './support/personas';
import {
  cancelReservation,
  closeDialog,
  expectHeldBy,
  goToDate,
  joinQueue,
  openSpot,
  reserveSpot,
} from './support/lot-page';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.waitlistPromotion);
const SPOT = 'E2.66';

test('cancelling a reservation promotes the first person in the queue', async ({
  userPage,
  userTwoPage,
}) => {
  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await reserveSpot(userPage, SPOT);
  await expectHeldBy(userPage, SPOT, USER.displayName);

  // The second user finds the bay taken and joins the queue.
  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);
  await expectHeldBy(userTwoPage, SPOT, USER.displayName);
  await joinQueue(userTwoPage, SPOT);

  // The badge on the tile and the position in the dialog are two different
  // fields of `overview.day` (`waitlistCount` and `viewerWaitlistPosition`);
  // both are checked, because a queue of one that reports no position is not a
  // queue anyone can be promoted out of.
  await expect(userTwoPage.getByText('1 ve frontě')).toBeVisible();
  const queued = await openSpot(userTwoPage, SPOT);
  await expect(queued).toContainText('Ve frontě jste 1. v pořadí.');
  await closeDialog(userTwoPage);

  // The holder gives the bay back. Nothing else is clicked.
  await cancelReservation(userPage, SPOT);

  await userTwoPage.reload();
  await goToDate(userTwoPage, DATE);
  await expectHeldBy(userTwoPage, SPOT, USER_TWO.displayName);

  // The promotion consumed the queue entry — the badge is gone and the dialog
  // now offers to cancel, not to queue.
  await expect(userTwoPage.getByText('1 ve frontě')).toHaveCount(0);
  const promoted = await openSpot(userTwoPage, SPOT);
  await expect(promoted).toContainText('Vaše rezervace');
  await closeDialog(userTwoPage);

  // Leave the day as it was found.
  await cancelReservation(userTwoPage, SPOT);
});
