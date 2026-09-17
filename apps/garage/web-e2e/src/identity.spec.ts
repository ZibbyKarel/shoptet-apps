/**
 * That each persona is the person the suite thinks it is.
 *
 * `apps/garage/web-e2e/src/support/personas.ts` re-states three rows of
 * `libs/garage/database/src/lib/seed-data.ts` — it cannot import them across the
 * `scope:web` / `scope:api` boundary. This spec is what keeps the copy honest:
 * it signs each persona in and asserts the application shows the *seeded* name
 * and the *seeded* role. If somebody renames a seed user or moves the admin
 * flag, this goes red here rather than as a baffling permission failure inside
 * `admin-reservation.spec.ts`.
 *
 * It is also the standing proof that the role is not in the token. The claims
 * the login helper types carry an email and a name and nothing else; `Dev
 * Admin` is an admin because a column says so.
 */

import { expect, test } from './support/fixtures';
import { LOT_PATH } from './support/oidc-login';
import { ADMIN, USER, USER_TWO } from './support/personas';

test('the admin persona is the seeded admin', async ({ adminPage }) => {
  await adminPage.goto(LOT_PATH);

  await expect(adminPage.getByRole('button', { name: 'Uživatelské menu' })).toContainText(
    ADMIN.displayName
  );
  await adminPage.getByRole('button', { name: 'Uživatelské menu' }).click();
  await expect(adminPage.getByText(ADMIN.claims['email'] as string)).toBeVisible();
  await expect(adminPage.getByRole('menuitem', { name: 'Správa' })).toBeVisible();
});

test('the ordinary personas are not admins', async ({ userPage, userTwoPage }) => {
  for (const [page, persona] of [
    [userPage, USER],
    [userTwoPage, USER_TWO],
  ] as const) {
    await page.goto(LOT_PATH);
    await expect(page.getByRole('button', { name: 'Uživatelské menu' })).toContainText(
      persona.displayName
    );
    await page.getByRole('button', { name: 'Uživatelské menu' }).click();
    await expect(page.getByText(persona.claims['email'] as string)).toBeVisible();
    // No `Správa` entry, and no admin badge beside the name.
    await expect(page.getByRole('menuitem', { name: 'Správa' })).toHaveCount(0);
  }
});
