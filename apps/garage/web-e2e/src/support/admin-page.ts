/**
 * The administration screen, as the specs talk to it.
 *
 * The same rules as `lot-page.ts`, for the same reasons: everything is
 * addressed by role and by the Czech accessible name the UI renders (the
 * `admin` namespace of `apps/garage/web/messages/cs.json`), there are no
 * `data-testid` hooks, and every wait is on a condition rather than a delay.
 *
 * `/admin` is a route, not a modal, and `AdminScreen` puts its four sections
 * behind an ARIA tab strip (`libs/shared/design-system/src/primitives/lib/tabs`), so
 * reaching a section is two steps: arrive at the route, then select the tab.
 * {@link goToAdminTab} does both, and asserts the arrival — a screen that
 * renders the `FORBIDDEN` empty state because the profile has not landed yet
 * looks exactly like a screen whose tab is simply empty, and a spec should
 * never have to guess which one it got.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/** The administration route. `apps/garage/web/src/routes.ts`'s `ADMIN_ROUTE`. */
export const ADMIN_PATH = '/admin';

/**
 * The first visit to a route in this suite pays for the production server's
 * first render of it, which is slower than Playwright's 5 s default expect
 * timeout on a loaded machine. Same value and same reason as `lot-page.ts`'s.
 */
const FIRST_ROUTE_VISIT_TIMEOUT_MS = 30_000;

/** The four tabs of `AdminScreen`, by the label each one renders. */
export const ADMIN_TABS = {
  overview: 'Přehled parkoviště',
  users: 'Uživatelé',
  spots: 'Parkovací místa',
  window: 'Rezervační okno',
} as const;

export type AdminTab = keyof typeof ADMIN_TABS;

/**
 * Opens `/admin` and selects one tab, returning that tab's panel.
 *
 * Scoping every later query to the returned `tabpanel` is not tidiness: the
 * heading "Uživatelé" is both a tab label and the users card's own title, and
 * several strings ("Zrušit", "Uložit") appear on more than one tab. A locator
 * built on the page would match the strip as readily as the body.
 */
export async function goToAdminTab(page: Page, tab: AdminTab): Promise<Locator> {
  await page.goto(ADMIN_PATH);

  // The eyebrow, not the tab strip: it renders for an admin and for nobody
  // else, so waiting on it distinguishes "the screen is up" from "the profile
  // has not arrived" — which the strip cannot, since it is absent in both.
  await expect(page.getByRole('heading', { name: 'Správa', level: 1 })).toBeVisible({
    timeout: FIRST_ROUTE_VISIT_TIMEOUT_MS,
  });

  const strip = page.getByRole('tablist', { name: 'Sekce správy' });
  const trigger = strip.getByRole('tab', { name: ADMIN_TABS[tab], exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-selected', 'true');

  const panel = page.getByRole('tabpanel');
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * The row of a `DataTable` whose label cell starts with `label`, within `panel`.
 *
 * Anchored on the start of a cell's accessible name rather than on row text, so
 * a row is never found by something that merely appears somewhere inside one of
 * its other columns — a holder's name, a plate, a category. (The filter accepts
 * *any* cell whose name starts with `label`, not strictly the first one; in
 * these two tables only the label column can start that way, and a locator that
 * insisted on cell index would break the moment a column is reordered.)
 *
 * **`label` may be followed by more text in the same cell, and that is why this
 * is not an exact match.** It was `{ name: label, exact: true }`, which is
 * correct right up to the moment the row acquires a badge: the spots table's
 * label cell is `<span>{spot.label}</span>` plus a `<Badge>Neaktivní</Badge>`
 * when the spot is retired (`admin-spots-screen.tsx`'s `label` column), so the
 * cell's accessible name becomes "E2E.01 Neaktivní" and an exact match stops
 * finding the row at all. Measured: `admin-spots.spec.ts`'s toggle test failed
 * with "element(s) not found" on exactly that row, one test after the spot was
 * retired.
 *
 * A bare substring match would be worse than either — "E2.9" would select
 * "E2.92". So the pattern anchors the start of the accessible name and demands
 * that anything following `label` begin with whitespace, which a badge's text
 * does and a longer label does not.
 */
export function tableRow(panel: Locator, label: string): Locator {
  const firstCell = new RegExp(`^${escapeForRegExp(label)}(\\s|$)`, 'u');
  return panel
    .getByRole('row')
    .filter({ has: panel.page().getByRole('cell', { name: firstCell }) });
}

/** Escapes the regex metacharacters a spot label or a person's name can carry. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Waits for the "Nastavení uloženo." toast the reservation-window controls
 * raise (`admin.windowSaved`, the only screen with this toast — it is the only
 * one that saves on change without a row of its own to show the result).
 *
 * **Only that it appears — this toast never goes away on its own.** This
 * function also waited for it to be hidden, on the assumption that a toast
 * auto-dismisses, and that assumption was simply false: `admin-window-screen.tsx`
 * renders it while `saveErrorMessage === null && isSaved`, i.e. for as long as
 * the mutation's success state lasts, and `Toast` has no timer — its only way
 * out is the optional dismiss button this screen does not pass. Measured: the
 * assertion timed out after 30 s with "62 × locator resolved to
 * `<span>Nastavení uloženo.</span>` — unexpected value visible", taking the
 * spec and its `afterAll` restore down with it.
 *
 * What the removed half was for was making sure a *stale* toast could not be
 * mistaken for this save's. That guarantee now comes from the caller instead,
 * and it is a real one: `goToAdminTab` starts with `page.goto`, so every
 * `ensureLockMode` meets a freshly mounted screen whose `isSaved` is false, and
 * a visible toast on it can only be the save just made. A caller that clicks
 * twice without navigating in between must assert the outcome — the month
 * list's wording, the selected pill — rather than this.
 */
export async function expectWindowSettingsSaved(page: Page): Promise<void> {
  await expect(page.getByText('Nastavení uloženo.', { exact: true })).toBeVisible();
}

export { FIRST_ROUTE_VISIT_TIMEOUT_MS };
