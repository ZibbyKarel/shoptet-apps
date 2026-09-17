/**
 * The realtime cell lock, seen from the other side.
 *
 * Two browser contexts on the same day. One opens a bay's dialog; the other
 * must see that bay hatch over as "právě upravuje / Dev User" — and, when the
 * dialog closes, see it go back to being reservable.
 *
 * Nothing in this file polls or reloads. The second page is never told
 * anything: `useCellLock` takes the hold over the socket, the gateway
 * broadcasts `cell:locked` to the day room excluding the asker, and
 * `useCellLocks` turns it into the tile's `editing` appearance. If the socket
 * is not connected, or the hold is not taken, or the broadcast is not sent,
 * nothing on the second page ever changes and the assertion times out — which
 * is the point: this is the one scenario whose defence is *only* realtime.
 *
 * That is also why it does not assert on the yellow hatch's colours. What is
 * checked is what the state means to a user: the tile says somebody is editing,
 * names them, and refuses to be clicked.
 *
 * The one thing each test *does* wait for before acting is
 * {@link waitForDayRoom} on the observing page. A `cell:locked` broadcast is
 * never replayed to a socket that joins afterwards, so taking the hold before
 * the observer is in the room is not a slow test — it is a test asking about an
 * event that was already sent to nobody. See `realtime.ts` and
 * `doc/decision/0187-*` for the measurement behind that.
 */

import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import { expect, test } from './support/fixtures';
import { LOT_PATH } from './support/oidc-login';
import { USER } from './support/personas';
import { closeDialog, goToDate, openSpot, spotTile } from './support/lot-page';
import { waitForDayRoom } from './support/realtime';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.cellLock);

/**
 * One bay per test, and it has to stay that way.
 *
 * `nxE2EPreset` sets `fullyParallel: true`, so these two tests run in **separate
 * workers at the same time** — `dates.ts` gives each *spec file* its own day,
 * but two tests inside one file share it. They also drive the same persona, and
 * a hold is *acquired* by **user** (`lock.service.ts`, deliberately: it is what
 * makes a reconnect a renewal). Share a bay and each test's dialog takes the
 * hold over from the other, and the observed tile stops meaning what the
 * assertion says it means.
 *
 * Since `doc/decision/0220-*` a *release* also has to come from the connection
 * that holds the cell. That helps in one direction only: the test whose dialog
 * opened **first** can no longer drop the other's hold. The one that opened
 * second still can — its `cell:lock` re-keyed the hold onto its own socket, so
 * its `closeDialog` is a legitimate release, and the first test's tile goes back
 * to `Volné` under an open dialog. Sharing a bay is still a bug, and this is
 * still why these two are separate.
 *
 * Review measured it before the split: 4 failures in 14 runs at default
 * parallelism, 0 in 8 at `--workers=1`, 0 in 10 with distinct bays. A later
 * attempt to reproduce it deliberately — this map pointed back at one bay —
 * came back **green 22 times running** (10 of this spec alone, 12 of the full
 * suite). So the hazard is real by construction but does not fire on demand:
 * it needs an interleaving where one test's `closeDialog` lands between the
 * other's `cell:lock` and its assertion, and that window is small. A green run
 * is not evidence that sharing a bay is safe.
 *
 * A new test in this file needs a bay of its own — not `mode: 'serial'`, which
 * would hide the constraint by removing the concurrency rather than by
 * respecting it.
 */
const SPOTS = {
  lockAndRelease: 'E2.61',
  ownHold: 'E2.92',
} as const;

test('one user opening a bay locks it for the other, and releases it on close', async ({
  userPage,
  userTwoPage,
}) => {
  const SPOT = SPOTS.lockAndRelease;

  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);

  const observed = spotTile(userTwoPage, SPOT);
  // Before anything happens the bay is offered to the observer, by the name a
  // free tile carries. Without this the "locked" assertion below could pass
  // against a tile that was never free in the first place.
  await expect(userTwoPage.getByRole('button', { name: `Rezervovat místo ${SPOT}` })).toBeVisible();

  // The observer has to be in the room before the hold is taken, or the
  // broadcast is sent to nobody and never sent again.
  await waitForDayRoom(userTwoPage, DATE);

  await openSpot(userPage, SPOT);

  await expect(observed).toContainText('právě upravuje');
  await expect(observed).toContainText(USER.displayName);
  // `lot-view.ts` gives an `editing` tile `action: 'none'`, and `lot-grid.tsx`
  // renders that as a genuinely disabled button — not a click handler that
  // returns early. The observer cannot open a bay somebody else is editing.
  await expect(observed).toBeDisabled();

  await closeDialog(userPage);

  await expect(userTwoPage.getByRole('button', { name: `Rezervovat místo ${SPOT}` })).toBeEnabled();
});

test('the holder never sees their own hold', async ({ userPage, userTwoPage }) => {
  const SPOT = SPOTS.ownHold;

  await userPage.goto(LOT_PATH);
  await goToDate(userPage, DATE);
  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);
  await waitForDayRoom(userTwoPage, DATE);

  await openSpot(userPage, SPOT);

  // The second page proves the hold really was taken and broadcast…
  await expect(spotTile(userTwoPage, SPOT)).toContainText('právě upravuje');
  // …and the first page proves the holder's own tile is untouched underneath
  // the dialog. `toSpotView` drops a lock whose holder is the viewer.
  await closeDialog(userPage);

  // The negated assertion below would pass against a tile that does not exist,
  // so it is paired with a positive one on the *same* locator rather than
  // leaning on the free-tile assertion above it: this pair stays correct even
  // if that line is ever changed or removed.
  const holderTile = spotTile(userPage, SPOT);
  await expect(userPage.getByRole('button', { name: `Rezervovat místo ${SPOT}` })).toBeVisible();
  await expect(holderTile).toContainText(SPOT);
  await expect(holderTile).not.toContainText('právě upravuje');
});
