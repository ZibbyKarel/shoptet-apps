/**
 * An admin bulk-books on behalf of another user.
 *
 * `Dev Admin` opens the bulk-reservation modal, picks `Dev User` from the
 * holder selector the same way `SpotDialog`'s admin holder picker already
 * works for a single reservation, selects one day, and confirms. The
 * resulting reservation belongs to `Dev User`, verified from the user's own
 * context — not from the admin's — the same verification shape
 * `admin-reservation.spec.ts` uses for the single-reservation admin journey.
 */

import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import { test } from './support/fixtures';
import { LOT_PATH } from './support/oidc-login';
import { USER } from './support/personas';
import {
  bulkResultSpotLabel,
  closeBulkResult,
  confirmBulkSchedule,
  expectHeldBy,
  generateBulkSchedule,
  goToDate,
  openBulkModal,
  pickBulkHolder,
  selectBulkDay,
} from './support/lot-page';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.adminBulkReservation);

test('an admin bulk-books a day for another user', async ({ adminPage, userPage }) => {
  await adminPage.goto(LOT_PATH);
  await goToDate(adminPage, DATE);

  await openBulkModal(adminPage);
  await pickBulkHolder(adminPage, USER.displayName);
  await selectBulkDay(adminPage, DATE);
  await generateBulkSchedule(adminPage);
  await confirmBulkSchedule(adminPage);
  // The allocator picks the spot; read back which one it actually assigned
  // rather than assuming any particular label.
  const label = await bulkResultSpotLabel(adminPage, DATE);
  await closeBulkResult(adminPage);

  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await expectHeldBy(userPage, label, USER.displayName);
});
