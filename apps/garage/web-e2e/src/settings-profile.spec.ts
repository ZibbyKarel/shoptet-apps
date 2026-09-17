/**
 * Personal settings: licence plate, preferred parking spot, and the ICS feed
 * token, as a person edits them through Nastavení.
 *
 * This belongs at the browser layer, not a lower one, because the point of
 * the licence-plate field is what it does to *another* screen: `spot-tile.tsx`
 * reads `holderPlate` from the reservation's owner, never from the reservation
 * form itself (`spot-dialog.tsx` has no plate input), so the only way to prove
 * "I set my plate and it shows up on the bay I reserve" is to drive both
 * screens in one browser and read the overview's own accessible name — a unit
 * test of either screen alone would have to assume the wiring between them.
 * The same is true of the ICS token: regenerating it is meaningless to assert
 * from `me.service.ts` alone, because the interesting claim is that the *old*
 * URL, fetched exactly the way a calendar client fetches it, stops answering.
 *
 * **Dev User Two**, not Dev User: `ics-feed.spec.ts` already owns Dev User's
 * ICS token (a user-scoped mutation), and `reservation.spec.ts` already owns
 * Dev User's licence-plate display. Dev User Two is seeded with
 * `licensePlate: null` and no preferred spot (`libs/garage/database/src/lib/
 * seed-data.ts`) — the more interesting starting state for "a user with no
 * plate sets one" — and reusing it here means this spec cannot collide with
 * either of theirs on the one-mutation-per-user assumptions those specs make.
 *
 * One bay (`SPOT`) and one day (`SPEC_DAY_SLOTS.settingsProfile`) for the
 * whole file: any state found there at the start is treated as *this spec's
 * own* leftover from an interrupted run — never another persona's, confirmed
 * by the dialog reading "Vaše rezervace" before anything is cancelled.
 *
 * Serial, like `reservation.spec.ts`: each test is one moment of the same
 * story (no plate → a plate set → a preferred spot → a rotated calendar
 * link), so a failure partway through has nothing later tests could still
 * prove.
 *
 * Setup and teardown are `test.beforeAll`/`test.afterAll`, not tests. A
 * `test()` standing in for either would be reported as a passing test that
 * verified nothing (setup) or — worse — be *skippable*: under `serial` mode a
 * failure anywhere upstream skips every test after it, and a restore written
 * as a `test()` is exactly the one that then never runs, leaving Dev User Two
 * holding a plate, a preferred spot and a reservation for the next run to
 * trip over. `admin-users.spec.ts` and `admin-window.spec.ts` restore their
 * own mutable fixtures the same way, each opening its own context from
 * `storageStatePath(...)` because a `Page` fixture does not exist at hook
 * scope. `afterAll` runs whatever happened upstream, which is the actual
 * guarantee this file needs to make.
 *
 * The licence plate this file sets on Dev User Two for tests 2 through 4 does
 * not perturb the other specs that also drive this persona concurrently
 * (`cell-lock.spec.ts`, `waitlist-promotion.spec.ts`,
 * `realtime-connection.spec.ts`): every one of them reads the tile with
 * `expectHeldBy`/`toContainText`, which an extra plate substring cannot break.
 * Only an assertion narrowed to an *exact* tile name would need to account
 * for this file.
 */

import type { Locator, Page } from '@playwright/test';
import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import { expect, test } from './support/fixtures';
import { LOT_PATH } from './support/oidc-login';
import { USER_TWO, storageStatePath } from './support/personas';
import {
  expectFree,
  expectHeldBy,
  goToDate,
  openSettings,
  openSpot,
  reserveSpot,
  spotTile,
} from './support/lot-page';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.settingsProfile);
const SPOT = 'E2.66';
/**
 * A different seeded, active bay — never `SPOT`. The exact rendered text of
 * a `<select>` option, checked directly in `settings-screen.tsx`:
 * `<option value={spot.id}>{spot.label} · {spot.group}</option>`, and
 * `E2.61`'s seeded `group` is `'SHARED'` (`libs/garage/database/src/lib/
 * seed-data.ts`) — not assumed from either file alone. `selectByLabel` below
 * throws loudly if this ever stops matching, rather than silently picking
 * nothing.
 *
 * `waitlist-queue.spec.ts` also works this bay, but only a *reservation*
 * competes for a bay — a preferred-spot *preference* books nothing, so there
 * is no shared-resource conflict here. Keep this spot rather than moving to
 * another one to "fix" an imagined collision.
 */
const PREFERRED_SPOT_OPTION = 'E2.61 · SHARED';
/** Already in the seeded style (`libs/garage/database/src/lib/seed-data.ts`), so the
 * server, which stores `licensePlate` verbatim (`me.service.ts`), needs no
 * normalization for the prefill assertion to compare literally. */
const PLATE = '9XY 4321';

/**
 * Reads back the `value` Playwright resolved `label` to, refusing to
 * continue on `undefined` — the option genuinely does not exist — rather than
 * handing a later assertion a value it can only fail on.
 */
async function selectByLabel(select: Locator, label: string): Promise<string> {
  const [value] = await select.selectOption({ label });
  if (value === undefined) {
    throw new Error(`"${label}" did not match any option.`);
  }
  return value;
}

/**
 * Cancels `label` only when the dialog just opened on it reads "Vaše
 * rezervace" — i.e. *this* persona already holds it, most likely because an
 * earlier run of this spec was interrupted before its own restore step ran.
 * A bay held by anyone else, or not held at all, is simply closed again: this
 * spec must never cancel a reservation it does not own.
 *
 * Lives outside any `test()` body on purpose — `playwright/no-conditional-in-test`
 * flags a branch taken directly inside a test, and the branch here is not
 * something the test should have to know about; it is this helper's whole job.
 *
 * `isVisible()` does not wait — it reads whatever is in the DOM at that
 * instant. That is safe here only because `SpotDialog`
 * (`apps/garage/web/src/lot/spot-dialog/spot-dialog.tsx`) is presentational and
 * renders synchronously from the already-fetched `overview.day` data; see
 * `waitlist-queue.spec.ts`'s `leaveQueueIfQueued` for the full argument and
 * the `tableRow` precedent this is the same class of bug as. If the dialog
 * ever gains a lazy fetch or a loading skeleton, this would silently pick
 * the wrong branch and leave real state behind for the next spec.
 */
async function cancelIfOwnLeftover(page: Page, label: string) {
  const dialog = await openSpot(page, label);
  const isOwnReservation = await dialog.getByText('Vaše rezervace').isVisible();
  const buttonName = isOwnReservation ? 'Zrušit rezervaci' : 'Zavřít';
  await dialog.getByRole('button', { name: buttonName }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Clears the licence plate and preferred spot in whatever settings dialog is
 * already open on `page`, saves, and waits for the modal to close. Shared by
 * `beforeAll` (normalizing an interrupted previous run) and `afterAll`
 * (restoring the seeded state this file is done with).
 */
async function clearSettings(page: Page) {
  const settings = await openSettings(page);
  await settings.getByLabel('SPZ auta').fill('');
  await settings
    .getByLabel('Preferované parkovací místo')
    .selectOption({ label: 'Bez preference' });
  await settings.getByRole('button', { name: 'Uložit' }).click();
  await expect(settings).toBeHidden();
}

test.describe.configure({ mode: 'serial' });

// Setup: tolerates a leftover reservation or settings from an interrupted
// previous run of this file — see the file docblock for why this is a hook,
// not a test. `cancelIfOwnLeftover`'s branch is exactly what
// `playwright/no-conditional-in-test` exists to keep out of a `test()` body,
// which does not apply to a hook.
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: storageStatePath(USER_TWO) });
  const page = await context.newPage();
  try {
    await page.goto(LOT_PATH);
    await goToDate(page, DATE);
    await cancelIfOwnLeftover(page, SPOT);
    await clearSettings(page);
  } finally {
    await context.close();
  }
});

// Teardown: restores Dev User Two's seeded state (no plate, no preferred
// spot, no reservation) unconditionally — `afterAll` runs even when an
// earlier test in this `serial` group failed, which is the one guarantee a
// `test()` standing in its place could not make.
test.afterAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: storageStatePath(USER_TWO) });
  const page = await context.newPage();
  try {
    await page.goto(LOT_PATH);
    await clearSettings(page);
    await goToDate(page, DATE);
    await cancelIfOwnLeftover(page, SPOT);
    await expectFree(page, SPOT);
  } finally {
    await context.close();
  }
});

test('a user with no plate on file reserves a bay, and the tile shows only their name', async ({
  userTwoPage,
}) => {
  await userTwoPage.goto(LOT_PATH);
  await goToDate(userTwoPage, DATE);

  await expectFree(userTwoPage, SPOT);
  await reserveSpot(userTwoPage, SPOT);
  await expectHeldBy(userTwoPage, SPOT, USER_TWO.displayName);

  // The point of the recent product rule: a holder with no plate on file gets
  // no placeholder text at all. `spot-tile.tsx` builds the tile's whole
  // accessible name as `[action, holderName, holderPlate].filter(non-null)`,
  // so a plate-less holder's name is also the *last* word in it — a positive
  // assertion, not just the absence of one string.
  await expect(spotTile(userTwoPage, SPOT)).toHaveAccessibleName(
    `Otevřít místo ${SPOT}, ${USER_TWO.displayName}`
  );
  await expect(spotTile(userTwoPage, SPOT)).not.toContainText('SPZ neuvedena');
});

test('setting a licence plate prefills it next time and appears on the already-reserved bay, surviving a reload', async ({
  userTwoPage,
}) => {
  await userTwoPage.goto(LOT_PATH);

  const settings = await openSettings(userTwoPage);
  const plateField = settings.getByLabel('SPZ auta');
  await expect(plateField).toHaveValue('');
  await plateField.fill(PLATE);
  await settings.getByRole('button', { name: 'Uložit' }).click();
  await expect(settings).toBeHidden();

  // Saving redirects to the lot's default day; find the reservation again.
  await goToDate(userTwoPage, DATE);
  await expectHeldBy(userTwoPage, SPOT, PLATE);

  // It is in the database, not component state.
  await userTwoPage.reload();
  await goToDate(userTwoPage, DATE);
  await expectHeldBy(userTwoPage, SPOT, PLATE);

  const settingsAgain = await openSettings(userTwoPage);
  await expect(settingsAgain.getByLabel('SPZ auta')).toHaveValue(PLATE);
  await settingsAgain.getByRole('button', { name: 'Zrušit', exact: true }).click();
  await expect(settingsAgain).toBeHidden();
});

test('a preferred parking spot persists across a reload, then clears back to no preference', async ({
  userTwoPage,
}) => {
  await userTwoPage.goto(LOT_PATH);

  const settings = await openSettings(userTwoPage);
  const preferredSpot = settings.getByLabel('Preferované parkovací místo');
  const selectedValue = await selectByLabel(preferredSpot, PREFERRED_SPOT_OPTION);
  await settings.getByRole('button', { name: 'Uložit' }).click();
  await expect(settings).toBeHidden();

  await userTwoPage.reload();
  const settingsAfterReload = await openSettings(userTwoPage);
  await expect(settingsAfterReload.getByLabel('Preferované parkovací místo')).toHaveValue(
    selectedValue
  );

  await settingsAfterReload
    .getByLabel('Preferované parkovací místo')
    .selectOption({ label: 'Bez preference' });
  await settingsAfterReload.getByRole('button', { name: 'Uložit' }).click();
  await expect(settingsAfterReload).toBeHidden();

  await userTwoPage.reload();
  const settingsFinal = await openSettings(userTwoPage);
  await expect(settingsFinal.getByLabel('Preferované parkovací místo')).toHaveValue('');
  await settingsFinal.getByRole('button', { name: 'Zrušit', exact: true }).click();
  await expect(settingsFinal).toBeHidden();
});

test('regenerating the calendar link changes the URL, revokes the old one, and the new one works', async ({
  userTwoPage,
  playwright,
}) => {
  await userTwoPage.goto(LOT_PATH);

  const settings = await openSettings(userTwoPage);
  const urlField = settings.getByLabel('Odkaz na kalendář');
  await expect(urlField).toHaveValue(/\/api\/calendar\/.+\.ics$/u);
  const oldUrl = await urlField.inputValue();

  const anonymous = await playwright.request.newContext();
  try {
    const before = await anonymous.get(oldUrl);
    expect(before.status()).toBe(200);
    expect(before.headers()['content-type']).toContain('text/calendar');

    await settings.getByRole('button', { name: 'Vygenerovat nový odkaz' }).click();
    const confirm = userTwoPage.getByRole('dialog', { name: 'Vygenerovat nový odkaz?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Vygenerovat', exact: true }).click();
    await expect(confirm).toBeHidden();

    await expect(urlField).not.toHaveValue(oldUrl);
    const newUrl = await urlField.inputValue();

    // The old URL is revoked, not merely wrong: `CalendarService.
    // feedEntriesForToken` (`apps/garage/api/src/calendar/calendar.service.ts`)
    // resolves the token with `where: { icsToken, active: true }` and throws a
    // bare `NotFoundException` on no match — the same 404, with the same
    // Nest-default body, that an unrecognized token gets. The controller
    // (`calendar.controller.ts`) sets `Content-Type`/`Cache-Control`/
    // `X-Robots-Tag` only *after* that lookup succeeds, so a revoked token's
    // 404 carries none of them — established by reading both files, not
    // measured behaviourally, per `doc/decision/0080-*` on why every failure
    // here is a 404 rather than a 401 (a 401 would let a token be enumerated
    // by response code alone).
    const revoked = await anonymous.get(oldUrl);
    expect(revoked.status()).toBe(404);
    expect(revoked.headers()['content-type']).not.toContain('text/calendar');

    const after = await anonymous.get(newUrl);
    expect(after.status()).toBe(200);
    expect(after.headers()['content-type']).toContain('text/calendar');
  } finally {
    await anonymous.dispose();
  }

  await userTwoPage.keyboard.press('Escape');
});
