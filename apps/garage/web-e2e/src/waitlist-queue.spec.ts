/**
 * The queue, from the side of the people who actually stand in it.
 *
 * `waitlist-promotion.spec.ts` already covers the one thing the *backend*
 * guarantees about a queue: cancelling a reservation promotes its head into a
 * real reservation, without anybody clicking anything. That is a promise
 * about `WaitlistPromotionService`, and it is asserted after a reload on
 * purpose, to keep it a claim about the database rather than about the
 * broadcast.
 *
 * This file is about everything promotion spec does not touch: what the
 * dialog *shows* a person about the queue they are about to join, that
 * joining and leaving are real, durable, database-backed actions rather than
 * client-side toggles, that a second joiner lands behind the first rather
 * than beside them, and the newer rule (TODO.md item 2) that an admin's
 * "add to queue" picker will not let them queue someone who is already
 * spoken for. None of this needs a cancellation anywhere in it, which is
 * exactly why it belongs in its own file rather than as more assertions
 * bolted onto the promotion journey.
 *
 * One thing worth being explicit about, found while reading
 * `spot-dialog.tsx` rather than assumed: the "Fronta" block — the heading,
 * `queueEmpty`/`waiting`, and the viewer's own position — is only ever drawn
 * when `isAdmin || spot.waitlistCount > 0`. An ordinary caller looking at a
 * spot nobody has queued for yet sees **no** queue section at all — not
 * `queueEmpty`, nothing — only the plain "Přidat se do fronty" offer
 * (`titleQueue`/`subQueue`/`ctaQueue`). `queueEmpty` is therefore copy an
 * ordinary user can never see: by the time their own join makes the count
 * positive, the branch has already moved on to `waiting`. So the "nobody is
 * waiting yet" assertion below is made from the **admin's** page, which sees
 * the block regardless of count, not from the second joiner as a first
 * instinct suggests.
 *
 * Everything here uses the shared `apps/garage/web-e2e/src/support` helpers for
 * navigation and for the plain "join"/"leave"/"reserve"/"cancel" actions; the
 * few admin-only interactions that support file has no vocabulary for (the
 * queue-target selector, reading the queue block as an admin sees it) are
 * written directly against `dialog`/`spotDialog`, matched by role and by the
 * literal Czech copy from `apps/garage/web/messages/cs.json`.
 */

import type { Page } from '@playwright/test';
import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import { expect, test } from './support/fixtures';
import { LOT_PATH } from './support/oidc-login';
import { ADMIN, USER } from './support/personas';
import {
  cancelReservation,
  closeDialog,
  expectFree,
  expectHeldBy,
  goToDate,
  joinQueue,
  openSpot,
  reserveSpot,
} from './support/lot-page';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.waitlistQueue);
const SPOT = 'E2.61';

// Six moments of one queue's life, in order — later ones depend on state the
// earlier ones left behind (a queued `Dev User Two`, a taken `E2.61`), the
// same reason `reservation.spec.ts` runs its three tests serially rather than
// as one long test: a shared failure should be reported once, not three
// times over.
test.describe.configure({ mode: 'serial' });

/**
 * Best-effort pre-flight: leaves `label`'s queue for whichever caller `page`
 * is signed in as, tolerating a run that got interrupted mid-queue last time.
 * A no-op (just closes the dialog) when this caller isn't queued.
 *
 * `isVisible()` does not wait, so this branch is only safe because
 * `SpotDialog` (`apps/garage/web/src/lot/spot-dialog/spot-dialog.tsx`) is
 * presentational: it renders entirely from the `spot: SpotView` prop it is
 * handed, which is the same already-fetched `overview.day` data the tile
 * grid rendered from — there is no async gap between "the dialog opened" and
 * "its reservation/queue buttons reflect the real state" for this read to
 * race. `cancelWhoeverHolds` below relies on the same fact, as do the
 * equivalents in `settings-profile.spec.ts` (`cancelIfOwnLeftover`) and
 * `admin-spots.spec.ts` (`cleanUpLeftoverSpot`). If `SpotDialog` ever grows a
 * lazy fetch or a loading skeleton, these branches would silently read stale
 * DOM, take the wrong path, and leave real state behind for the *next* spec
 * to trip over — the same class of bug `tableRow` had before it moved off an
 * exact match (`support/admin-page.ts`'s docblock on it).
 */
async function leaveQueueIfQueued(page: Page, label: string): Promise<void> {
  const dialog = await openSpot(page, label);
  const leave = dialog.getByRole('button', { name: 'Odejít z fronty' });
  if (await leave.isVisible()) {
    await leave.click();
    await expect(dialog).toBeHidden();
  } else {
    await closeDialog(page);
  }
}

/**
 * Best-effort pre-flight: cancels `label`'s reservation, whoever holds it —
 * run as the admin, because an admin's "Zrušit rezervaci" button is not
 * gated on being the holder (`spot-dialog.tsx`'s `showCancel`), unlike an
 * ordinary user's. That is what lets this free the spot regardless of which
 * persona an interrupted earlier run left holding it.
 *
 * Same non-waiting `.isVisible()` read as `leaveQueueIfQueued` above, safe
 * for the same reason — see its docblock.
 */
async function cancelWhoeverHolds(page: Page, label: string): Promise<void> {
  const dialog = await openSpot(page, label);
  const cancel = dialog.getByRole('button', { name: 'Zrušit rezervaci' });
  if (await cancel.isVisible()) {
    await cancel.click();
    await expect(dialog).toBeHidden();
  } else {
    await closeDialog(page);
  }
}

test('a second person joins an empty queue and is told their own position', async ({
  userPage,
  userTwoPage,
  adminPage,
}) => {
  // Pre-flight: queue entries first, then the reservation — leaving a queue
  // never disturbs anything, but cancelling a reservation while somebody is
  // still queued for it would promote them (`WaitlistPromotionService`)
  // instead of freeing the bay, which is the opposite of what a reset wants.
  // All three personas that can touch this bay are healed here, not just the
  // two this test itself queues below — the assertions that follow read the
  // *global* queue state (`waitlistCount`/`queueEmpty`), not this spec's own
  // writes, so a stray entry left by any of them from an interrupted run
  // would be visible too.
  await adminPage.goto(LOT_PATH);
  await goToDate(adminPage, DATE);
  await leaveQueueIfQueued(adminPage, SPOT);

  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);
  await leaveQueueIfQueued(userTwoPage, SPOT);

  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await leaveQueueIfQueued(userPage, SPOT);

  await adminPage.goto(LOT_PATH);
  await goToDate(adminPage, DATE);
  await cancelWhoeverHolds(adminPage, SPOT);

  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await expectFree(userPage, SPOT);
  await reserveSpot(userPage, SPOT);
  await expectHeldBy(userPage, SPOT, USER.displayName);

  // The admin sees the queue block even though nobody is in it yet — see the
  // module docs for why this is checked from the admin's page rather than the
  // second joiner's.
  const adminView = await openSpot(adminPage, SPOT);
  await expect(adminView).toContainText('Fronta'); // queueHeading
  await expect(adminView).toContainText('Nikdo nečeká — budete první v řadě.'); // queueEmpty
  await closeDialog(adminPage);

  // The second person finds the bay taken and is offered the queue — the
  // plain, non-admin copy, since they are not queued yet.
  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);
  const offered = await openSpot(userTwoPage, SPOT);
  await expect(offered).toContainText(
    'Místo je na tento den obsazené. Zařadíme vás do fronty — pokud se uvolní, místo dostane první v řadě.'
  ); // subQueue
  await expect(offered.getByRole('button', { name: 'Přidat se do fronty' })).toBeVisible(); // ctaQueue
  await closeDialog(userTwoPage);

  await joinQueue(userTwoPage, SPOT);

  // `queuePosition` is `"Ve frontě jste {position}. v pořadí."` (ICU, plain
  // substitution — no plural/select form) — for the first and only entry,
  // `{position}` is `1`. `waitlist-promotion.spec.ts:57` asserts the same
  // key's position-1 rendering, which corroborates this reading.
  const queued = await openSpot(userTwoPage, SPOT);
  await expect(queued).toContainText('Ve frontě jste 1. v pořadí.');
  await closeDialog(userTwoPage);
});

test('the queue membership survives a reload and a fresh visit', async ({ userTwoPage }) => {
  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);

  await userTwoPage.reload();
  await goToDate(userTwoPage, DATE);
  const reloaded = await openSpot(userTwoPage, SPOT);
  await expect(reloaded).toContainText('Ve frontě jste 1. v pořadí.');
  await closeDialog(userTwoPage);

  // A fresh navigation on top of the reload — no in-memory query cache
  // carried over, nothing but the session cookie — is the cheaper, more
  // literal version of "it is in the database".
  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);
  const fresh = await openSpot(userTwoPage, SPOT);
  await expect(fresh).toContainText('Ve frontě jste 1. v pořadí.');
  await closeDialog(userTwoPage);
});

test('leaving the queue puts the dialog back to offering to join', async ({ userTwoPage }) => {
  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);

  const dialog = await openSpot(userTwoPage, SPOT);
  await dialog.getByRole('button', { name: 'Odejít z fronty' }).click();
  // `leaveWaitlist`'s `onSuccess` is the same `onMutationSuccess` every write
  // in `lot-screen.tsx` uses — it closes the dialog itself.
  await expect(dialog).toBeHidden();

  // The state actually returned, not merely "a button was clicked": reopening
  // shows the join offer again, not the queued copy, and no position line.
  const reopened = await openSpot(userTwoPage, SPOT);
  await expect(reopened.getByRole('button', { name: 'Přidat se do fronty' })).toBeVisible();
  await expect(reopened.getByRole('button', { name: 'Odejít z fronty' })).toHaveCount(0);
  await expect(reopened).not.toContainText('Ve frontě jste');
  await closeDialog(userTwoPage);
});

test('a second queue entry lands at position 2, and the admin can only queue the one eligible person', async ({
  userPage,
  userTwoPage,
  adminPage,
}) => {
  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);
  await joinQueue(userTwoPage, SPOT);

  const requeued = await openSpot(userTwoPage, SPOT);
  await expect(requeued).toContainText('Ve frontě jste 1. v pořadí.');
  await closeDialog(userTwoPage);

  await adminPage.goto(LOT_PATH);
  await goToDate(adminPage, DATE);
  const adminDialog = await openSpot(adminPage, SPOT);

  // The recent product rule (TODO.md item 2): the admin's "add to queue"
  // selector is filtered server-side (`UsersService.excludedForQueueTarget`,
  // reached through `admin.user.list`'s `excludingReservedOrQueuedFor`) to
  // drop anyone who already holds a reservation that day, **or** is already
  // queued for this spot that day. `Dev User` is excluded for the former
  // reason (they hold the reservation), `Dev User Two` for the latter (they
  // are queued, just above). Asserted as absence-of-each rather than an exact
  // option count: `admin-users.spec.ts` temporarily flips the fourth seeded
  // account, `Dev Inactive`, to `active: true` while it exercises the
  // last-active-admin guard, and `fullyParallel: true` lets that run overlap
  // this one — an active `Dev Inactive` holds no reservation and is queued
  // nowhere, so it would legitimately appear here too and turn a count of 1
  // into 2 without either half of the product rule being broken. The two
  // absences below hold regardless of how many other active accounts a
  // concurrent run happens to create.
  const targetSelect = adminDialog.getByLabel('Přidat do fronty'); // queueHolderField
  // Anchored, not a plain substring: "Dev User" is itself a prefix of
  // "Dev User Two" (the same hazard `lot-page.ts`'s `reserveSpotFor` already
  // documents), so an unanchored match on either would find one name inside
  // the other's row.
  await expect(targetSelect.locator('option', { hasText: /^Dev User$/u })).toHaveCount(0);
  await expect(targetSelect.locator('option', { hasText: /^Dev User Two$/u })).toHaveCount(0);
  await expect(
    targetSelect.locator('option', { hasText: new RegExp(`^${ADMIN.displayName}$`, 'u') })
  ).toHaveCount(1);

  // `defaultQueueTargetId` (`queue-target-input.ts`) picks the viewer
  // whenever they appear *anywhere* in the filtered list, falling back to the
  // list's first entry only when they don't — it is not "whichever option a
  // list of one happens to contain". The admin is never excluded by this
  // spot/day's filter (they hold no reservation here and are not queued
  // here), so they are always in the list and always the default, regardless
  // of how many other active accounts a concurrent run adds to it. Submitting
  // without touching the select is therefore still exactly "queue the admin".
  await adminDialog.getByRole('button', { name: 'Přidat se do fronty' }).click(); // ctaQueue
  await expect(adminDialog).toBeHidden();

  const adminQueued = await openSpot(adminPage, SPOT);
  await expect(adminQueued).toContainText('Ve frontě jste 2. v pořadí.');
  await closeDialog(adminPage);

  // Clean up: drain the queue before cancelling the reservation, for the same
  // reason the pre-flight in the first test does — cancelling with somebody
  // still queued would hand the bay to `Dev User Two` instead of freeing it.
  const adminLeave = await openSpot(adminPage, SPOT);
  await adminLeave.getByRole('button', { name: 'Odejít z fronty' }).click();
  await expect(adminLeave).toBeHidden();

  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);
  const userTwoLeave = await openSpot(userTwoPage, SPOT);
  await userTwoLeave.getByRole('button', { name: 'Odejít z fronty' }).click();
  await expect(userTwoLeave).toBeHidden();

  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await cancelReservation(userPage, SPOT);
  await expectFree(userPage, SPOT);
});
