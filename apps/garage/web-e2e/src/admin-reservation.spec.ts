/**
 * An admin acting on somebody else's reservation.
 *
 * `Dev User` books a bay. `Dev Admin`, who has never seen that bay before,
 * opens it from the `⋯` affordance the design draws on a taken tile, gets the
 * admin-flavoured dialog ("Upravit rezervaci" / "Jako admin můžete rezervaci
 * kdykoliv zrušit."), and cancels it. The bay is then free — for the *user*
 * too, which is asserted from the user's own context rather than from the
 * admin's.
 *
 * Two things this deliberately does not do:
 *
 * - It does not reassign the reservation to somebody else. The contract has no
 *   procedure for that: `reservation.create` books for the caller and
 *   `reservation.cancel` gives a bay back, and "editing someone else's
 *   reservation" is composed from those. See `doc/decision/0125-*`.
 * - It does not pick a day the ordinary reservation window would have refused.
 *   An admin is exempt from the month window, but that exemption is not what is
 *   under test here, and leaning on it would mean the test also passed for an
 *   admin who could do nothing else.
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
  reserveSpot,
  reserveSpotFor,
  spotDialog,
  spotMenuButton,
} from './support/lot-page';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.adminReservation);
const SPOT = 'E2.62';
// A second SHARED bay, unused elsewhere in this file, so the new journey below
// does not collide with the two tests above it. `schema.prisma` comments the
// IT spots as reserved for the IT department and `reservation-policy.ts` has
// no enforcement of that found on this branch, but a SHARED label sidesteps
// the question entirely.
const SECOND_SPOT = 'E2.96';

// Both tests use the same bay on the same day and each leaves it free; serial
// mode says so, and stops the second from reporting the first one's failure a
// second time.
test.describe.configure({ mode: 'serial' });

test("an admin cancels another user's reservation from the tile's ⋯ menu", async ({
  adminPage,
  userPage,
}) => {
  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await reserveSpot(userPage, SPOT);
  await expectHeldBy(userPage, SPOT, USER.displayName);

  await adminPage.goto(LOT_PATH);
  await goToDate(adminPage, DATE);
  await expectHeldBy(adminPage, SPOT, USER.displayName);

  // The `⋯` button only exists for an admin on a taken tile (`showAdminMenu`).
  await spotMenuButton(adminPage, SPOT).click();

  const dialog = spotDialog(adminPage);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Upravit rezervaci');
  await expect(dialog).toContainText('Jako admin můžete rezervaci kdykoliv zrušit.');
  // Whose reservation it is, said out loud in the dialog.
  await expect(dialog).toContainText(USER.displayName);

  await dialog.getByRole('button', { name: 'Zrušit rezervaci' }).click();
  await expect(dialog).toBeHidden();

  await expectFree(adminPage, SPOT);

  // The bay is free for the person who lost it, not only on the admin's screen.
  await userPage.reload();
  await goToDate(userPage, DATE);
  await expectFree(userPage, SPOT);
});

test('an ordinary user gets no ⋯ menu on a bay that is not theirs', async ({
  adminPage,
  userPage,
}) => {
  // Booked by the admin this time, so the ordinary user is the outsider.
  await adminPage.goto(LOT_PATH);
  await goToDate(adminPage, DATE);
  await reserveSpot(adminPage, SPOT);

  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await expectHeldBy(userPage, SPOT, 'Dev Admin');

  await expect(spotMenuButton(userPage, SPOT)).toHaveCount(0);

  await adminPage.reload();
  await goToDate(adminPage, DATE);
  await spotMenuButton(adminPage, SPOT).click();
  await spotDialog(adminPage).getByRole('button', { name: 'Zrušit rezervaci' }).click();
  await expect(spotDialog(adminPage)).toBeHidden();
});

test('an admin books a bay for a colleague, and for a guest', async ({ adminPage, userPage }) => {
  await adminPage.goto(LOT_PATH);
  await goToDate(adminPage, DATE);

  await reserveSpotFor(adminPage, SPOT, USER.displayName);

  // It is the colleague's bay, on the colleague's own screen — not the admin's.
  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await expectHeldBy(userPage, SPOT, USER.displayName);

  // And a guest, on a second bay, needs no user account at all. Named without
  // "Host" in it — the dialog renders `<p>{holderName}<span>Host</span></p>`,
  // so a name containing "Host" would make the paragraph's full text
  // "…HostHost" and defeat an exact match.
  await reserveSpotFor(adminPage, SECOND_SPOT, 'Hosta', 'Jan Novotný');
  await expectHeldBy(adminPage, SECOND_SPOT, 'Jan Novotný');

  // Both bays go back, so this file's serial invariant still holds and a second
  // run of the suite starts from the same state as the first.
  await cancelReservation(adminPage, SPOT);
  await cancelReservation(adminPage, SECOND_SPOT);
  await expectFree(adminPage, SPOT);
  await expectFree(adminPage, SECOND_SPOT);
});
