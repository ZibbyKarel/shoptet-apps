/**
 * User administration: the "Uživatelé" tab of `/admin`.
 *
 * This is a browser-layer journey rather than a unit test for two reasons.
 * First, the two guards this file cares about — an admin cannot deactivate
 * their own account, and the last active admin cannot lose the role — are
 * deliberately *enforced on the API* (`UsersService.adminUpdate`) and only
 * *echoed* on the screen as a disabled switch (see the docblock of
 * `admin-users-screen.tsx`). A unit test of the screen can assert the echo;
 * only a real signed-in session proves the switch is disabled for the actual
 * viewer of the actual seeded data, not a prop a test handed it. Second, the
 * `/admin` role gate (`admin-screen.tsx`) is itself only a courtesy over the
 * same API guard, and the FORBIDDEN empty state it renders for a plain user
 * is real routing + a real profile fetch, not a mounted component.
 *
 * ## The account this file is allowed to touch
 *
 * `Dev Admin` / `Dev User` / `Dev User Two` are signed in by every other spec
 * running concurrently (`fullyParallel: true`), so their role and `active`
 * flag must never change here. The fourth seeded account, **Dev Inactive**
 * (`inactive@example.com`, `role: 'USER'`, `active: false` —
 * `libs/garage/database/src/lib/seed-data.ts`), is not used anywhere else and is
 * this file's only mutable fixture. Every test that flips one of its
 * switches flips it back before finishing, and `test.afterAll` below is a
 * second line of defence: it restores Dev Inactive unconditionally, so a run
 * that starts after an earlier one was interrupted mid-test still ends in
 * the seeded state, and `prisma db seed` is never the only thing standing
 * between this file and a stuck fixture.
 *
 * Serial mode is not about isolation from other spec files (there is none —
 * the database is shared) but about the story inside *this* file: the
 * role-guard test deliberately activates Dev Inactive to make the "last
 * active admin" count change, and it must not run interleaved with the
 * plain activate/deactivate test touching the same row.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import {
  ADMIN_PATH,
  FIRST_ROUTE_VISIT_TIMEOUT_MS,
  goToAdminTab,
  tableRow,
} from './support/admin-page';
import { ADMIN, storageStatePath } from './support/personas';

test.describe.configure({ mode: 'serial' });

const INACTIVE_NAME = 'Dev Inactive';
const INACTIVE_EMAIL = 'inactive@example.com';

// cs.json: admin.usersActiveToggleLabel / admin.usersAdminToggleLabel, with
// `{name}` filled in — Dev Inactive is never "self" (nobody signs in as it)
// and never the last admin (`Dev Admin` is always the other active admin),
// so its two switches only ever carry the plain labels.
const INACTIVE_ACTIVE_LABEL = `Aktivní účet — ${INACTIVE_NAME}`;
const INACTIVE_ROLE_LABEL = `Admin role — ${INACTIVE_NAME}`;

// cs.json: admin.usersSelfActiveToggleLabel / usersLastAdminToggleLabel /
// usersSelfActiveHint / usersLastAdminHint, filled in for Dev Admin — the
// only viewer this file signs in as who can ever see either guard.
const ADMIN_SELF_ACTIVE_LABEL = 'Aktivní účet — Dev Admin · vlastní účet nelze deaktivovat';
const ADMIN_SELF_ACTIVE_HINT = 'Vlastní účet nelze deaktivovat.';
const ADMIN_LAST_ADMIN_LABEL =
  'Admin role — Dev Admin · poslední administrátor nemůže roli ztratit';
const ADMIN_LAST_ADMIN_HINT = 'Poslední aktivní administrátor nemůže přijít o roli.';
const ADMIN_PLAIN_ROLE_LABEL = 'Admin role — Dev Admin';

/**
 * Restores Dev Inactive to the seeded row (`role: 'USER'`, `active: false`),
 * tolerating a leftover state from an interrupted earlier run — each switch
 * is only clicked if it disagrees with the seed.
 */
async function restoreDevInactive(page: Page): Promise<void> {
  const panel = await goToAdminTab(page, 'users');
  const row = tableRow(panel, INACTIVE_NAME);

  const roleSwitch = row.getByRole('switch', { name: INACTIVE_ROLE_LABEL });
  if (await roleSwitch.isChecked()) {
    await roleSwitch.click();
    await expect(roleSwitch).not.toBeChecked();
  }

  const activeSwitch = row.getByRole('switch', { name: INACTIVE_ACTIVE_LABEL });
  if (await activeSwitch.isChecked()) {
    await activeSwitch.click();
    await expect(activeSwitch).not.toBeChecked();
  }
}

test.afterAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: storageStatePath(ADMIN) });
  const page = await context.newPage();
  try {
    await restoreDevInactive(page);
  } finally {
    await context.close();
  }
});

test('search narrows the table to a name or e-mail, and a non-matching search shows the empty state', async ({
  adminPage,
}) => {
  const panel = await goToAdminTab(adminPage, 'users');
  const search = panel.getByRole('searchbox', { name: 'Hledat uživatele' });

  // By name.
  await search.fill('Dev User Two');
  await expect(tableRow(panel, 'Dev User Two')).toBeVisible();
  await expect(tableRow(panel, 'Dev Admin')).toHaveCount(0);

  // By e-mail — `matchesUserSearch` matches name *or* email, and the two must
  // not disagree with `UsersService.adminList`'s own rule.
  await search.fill(INACTIVE_EMAIL);
  await expect(tableRow(panel, INACTIVE_NAME)).toBeVisible();
  await expect(tableRow(panel, 'Dev Admin')).toHaveCount(0);

  // No account has this in its name or e-mail.
  await search.fill('no-such-account-xyz');
  await expect(panel.getByText('Hledání nic nenašlo', { exact: true })).toBeVisible();
  await expect(panel.getByText('Zkuste jiné jméno nebo e-mail.', { exact: true })).toBeVisible();

  // Clearing the box brings everyone back.
  await search.fill('');
  await expect(tableRow(panel, 'Dev Admin')).toBeVisible();
  await expect(tableRow(panel, INACTIVE_NAME)).toBeVisible();
});

test('an admin activates Dev Inactive and then deactivates them again', async ({ adminPage }) => {
  let panel = await goToAdminTab(adminPage, 'users');
  let row = tableRow(panel, INACTIVE_NAME);
  let activeSwitch = row.getByRole('switch', { name: INACTIVE_ACTIVE_LABEL });

  await expect(activeSwitch).not.toBeChecked();

  await activeSwitch.click();
  await expect(activeSwitch).toBeChecked();

  // A fresh navigation, not just the mutation's own settled state: the switch
  // reads from the cache `admin.user.update`'s `onSettled` invalidated, and a
  // 200 that never actually persisted would look identical from there. Only a
  // reload proves the write reached the database and survives a fresh
  // `admin.user.list` fetch.
  panel = await goToAdminTab(adminPage, 'users');
  row = tableRow(panel, INACTIVE_NAME);
  activeSwitch = row.getByRole('switch', { name: INACTIVE_ACTIVE_LABEL });
  await expect(activeSwitch).toBeChecked();

  // Restore the seeded state before the test ends.
  await activeSwitch.click();
  await expect(activeSwitch).not.toBeChecked();

  // And confirm the restore persisted too, so the next test (and the
  // afterAll safety net) inherit the state they expect rather than a
  // cache-local illusion of it.
  panel = await goToAdminTab(adminPage, 'users');
  row = tableRow(panel, INACTIVE_NAME);
  activeSwitch = row.getByRole('switch', { name: INACTIVE_ACTIVE_LABEL });
  await expect(activeSwitch).not.toBeChecked();
});

test('an admin grants Dev Inactive the admin role and revokes it again, and the last-admin guard reacts to the count changing', async ({
  adminPage,
}) => {
  const panel = await goToAdminTab(adminPage, 'users');
  const adminRow = tableRow(panel, 'Dev Admin');
  const inactiveRow = tableRow(panel, INACTIVE_NAME);
  const inactiveRoleSwitch = inactiveRow.getByRole('switch', { name: INACTIVE_ROLE_LABEL });
  const inactiveActiveSwitch = inactiveRow.getByRole('switch', { name: INACTIVE_ACTIVE_LABEL });

  // Granting the role by itself does not change who counts as an "active
  // admin" (`activeAdminCount` only counts rows with `role === 'ADMIN' &&
  // active`), so Dev Inactive is activated first — the only way this file can
  // make Dev Admin stop being the sole active admin without touching Dev
  // Admin's own row.
  await inactiveActiveSwitch.click();
  await expect(inactiveActiveSwitch).toBeChecked();

  // Still only one active admin (Dev Admin) — the guard is up.
  await expect(adminRow.getByRole('switch', { name: ADMIN_LAST_ADMIN_LABEL })).toBeDisabled();

  await expect(inactiveRoleSwitch).not.toBeChecked();
  await inactiveRoleSwitch.click();
  await expect(inactiveRoleSwitch).toBeChecked();

  // Two active admins now — Dev Admin is no longer the *last* one, so their
  // own switch loses the guarded label and becomes enabled.
  await expect(adminRow.getByRole('switch', { name: ADMIN_PLAIN_ROLE_LABEL })).toBeEnabled();

  // Revoke the role again — back to one active admin, guard returns.
  await inactiveRoleSwitch.click();
  await expect(inactiveRoleSwitch).not.toBeChecked();
  await expect(adminRow.getByRole('switch', { name: ADMIN_LAST_ADMIN_LABEL })).toBeDisabled();

  // Restore Dev Inactive fully before the test ends.
  await inactiveActiveSwitch.click();
  await expect(inactiveActiveSwitch).not.toBeChecked();
});

test('the self-active and last-admin guards are visibly enforced on the viewer’s own row', async ({
  adminPage,
}) => {
  const panel = await goToAdminTab(adminPage, 'users');
  const row = tableRow(panel, 'Dev Admin');

  // `AdminUsersScreen` disables the viewer's own "Aktivní" switch
  // unconditionally (`isSelf`) and puts the reason in both the switch's own
  // accessible name and the row's `title`.
  const selfActiveSwitch = row.getByRole('switch', { name: ADMIN_SELF_ACTIVE_LABEL });
  await expect(selfActiveSwitch).toBeDisabled();
  await expect(row.getByTitle(ADMIN_SELF_ACTIVE_HINT, { exact: true })).toBeVisible();

  // Dev Admin is the only seeded admin, and nothing earlier in this
  // (serial) file leaves Dev Inactive granted the role, so Dev Admin is the
  // sole active admin here and the last-admin guard is up.
  const lastAdminSwitch = row.getByRole('switch', { name: ADMIN_LAST_ADMIN_LABEL });
  await expect(lastAdminSwitch).toBeDisabled();
  await expect(row.getByTitle(ADMIN_LAST_ADMIN_HINT, { exact: true })).toBeVisible();
});

test('an ordinary user who navigates to /admin gets the forbidden empty state', async ({
  userPage,
}) => {
  await userPage.goto(ADMIN_PATH);

  // `AdminScreen` fails closed for any role other than `'ADMIN'` — it never
  // renders the "Správa" heading, the tab strip, or any panel for `Dev User`.
  await expect(userPage.getByText('K této akci nemáte oprávnění.', { exact: true })).toBeVisible({
    timeout: FIRST_ROUTE_VISIT_TIMEOUT_MS,
  });
  await expect(userPage.getByRole('heading', { name: 'Správa' })).toHaveCount(0);
  await expect(userPage.getByRole('tablist')).toHaveCount(0);
});
