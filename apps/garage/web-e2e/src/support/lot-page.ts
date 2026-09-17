/**
 * The parking overview, as the specs talk to it.
 *
 * Everything here addresses the screen the way a person does — by role and by
 * the Czech accessible name the UI actually renders (`libs/shared/i18n`'s `lot`
 * namespace). There are no `data-testid` hooks in this application and none are
 * added here: a selector that matches the same string the user reads cannot
 * silently keep passing after the copy it names is gone, which is exactly the
 * failure mode an e2e suite is supposed to catch.
 *
 * Every wait is on a condition (Playwright's auto-retrying assertions and
 * `toPass`), never on a fixed delay. A `waitForTimeout` is load-bound: it
 * passes on an idle laptop and fails on a busy one.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { parseDateOnly, todayInPrague } from '@garage/shared-types';
import type { DateOnly } from '@garage/shared-types';
import { dayAndMonthCzech } from './dates';

/** The tile for one spot, whatever state it is in. */
export function spotTile(page: Page, label: string): Locator {
  // `lot-grid.tsx` labels a free tile "Rezervovat místo X" and every other
  // state "Otevřít místo X"; matching either is what lets one helper serve
  // both, without matching the `⋯` button ("Možnosti místa X").
  //
  // `(,|$)` rather than `$`, because the accessible name does not stop at the
  // label. `lot-grid.tsx` folds the bay's state into it — without that, a
  // screen-reader user heard "Otevřít místo E2.93" identically for a free bay,
  // a taken one, a window-locked one and one somebody else was editing — so
  // the name continues past `label` with a comma and the state. Anchoring on
  // the comma keeps the two things the original `$` was for: the tile is not
  // confused with the `⋯` button, and "místo E2.9" does not match "místo
  // E2.93".
  return page.getByRole('button', {
    name: new RegExp(`^(Rezervovat|Otevřít) místo ${label}(,|$)`, 'u'),
  });
}

/** The admin-only `⋯` button on a taken tile. */
export function spotMenuButton(page: Page, label: string): Locator {
  return page.getByRole('button', { name: `Možnosti místa ${label}` });
}

/** The spot dialog, once open. */
export function spotDialog(page: Page): Locator {
  return page.getByRole('dialog');
}

/**
 * Moves the screen to `target`.
 *
 * The day is component state, not a route, so it can only be reached through
 * the header's date pill, which opens `DatePickerDialog`. The year and month
 * `<select>`s inside it only browse the grid — see `date-picker-dialog.tsx` —
 * so this clicks the target day's own cell rather than stepping through days
 * one at a time, the way the sticky footer bar this replaced required.
 *
 * The pill is found by its leading Czech weekday name rather than by the full
 * formatted date: `fullDate` lives behind `@garage/i18n`'s barrel,
 * which also exports `./lib/provider` (JSX), and this project's
 * `tsconfig.json` has no `jsx` option — the same reason `lot-screen.tsx`'s
 * date arithmetic used to be mirrored here with `@garage/shared-types`
 * alone. A four-digit year alone is not enough to anchor it: a taken tile's
 * accessible name carries the holder's plate (`doc/decision/`'s license-plate
 * format is four digits too), so this anchors on the one thing on the whole
 * screen that starts with a weekday name. The day cell carries the same full
 * date as its accessible name — not the bare number the cell prints — so it
 * is matched the same way: a weekday word, then the wanted day number
 * followed immediately by a full stop, which no other day in the grid can
 * also produce (`7.` cannot match inside `17.` or `27.`).
 */
const CZECH_WEEKDAY_START = /^(pondělí|úterý|středa|čtvrtek|pátek|sobota|neděle) /u;

export async function goToDate(page: Page, target: DateOnly): Promise<void> {
  const wanted = parseDateOnly(target);
  const from = parseDateOnly(todayInPrague());

  await page.getByRole('button', { name: CZECH_WEEKDAY_START }).click();
  const dialog = page.getByRole('dialog', { name: 'Vybrat datum' });
  await expect(dialog).toBeVisible();

  if (wanted.year !== from.year) {
    await dialog.getByRole('combobox', { name: 'Rok' }).selectOption(String(wanted.year));
  }
  if (wanted.month !== from.month) {
    await dialog.getByRole('combobox', { name: 'Měsíc' }).selectOption(String(wanted.month));
  }

  await dialog
    .getByRole('button', { name: new RegExp(`^\\S+ ${String(wanted.day)}\\. `, 'u') })
    .click();
  await expect(dialog).toBeHidden();

  // Landing on a weekend or a public holiday would make every write on this
  // day impossible for a reason that has nothing to do with what is under
  // test, so the arrival is asserted rather than assumed.
  await expect(page.getByText('Pracovní den', { exact: true })).toBeVisible();
}

/** Opens a spot's dialog by clicking its tile. */
export async function openSpot(page: Page, label: string): Promise<Locator> {
  await spotTile(page, label).click();
  const dialog = spotDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Místo ${label}`);
  return dialog;
}

/** Closes whatever dialog is open, through its own "Zavřít" button. */
export async function closeDialog(page: Page): Promise<void> {
  await spotDialog(page).getByRole('button', { name: 'Zavřít' }).click();
  await expect(spotDialog(page)).toBeHidden();
}

/**
 * Reserves `label` for the day currently on screen.
 *
 * Returns once the dialog has closed, which `lot-screen.tsx` only does on a
 * **successful** mutation — a failure leaves the dialog open with the error in
 * it, so this cannot report success for a write that was refused.
 */
export async function reserveSpot(page: Page, label: string): Promise<void> {
  const dialog = await openSpot(page, label);
  await dialog.getByRole('button', { name: 'Rezervovat', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Reserves `label` for somebody else, as an admin: picks the holder in the
 * dialog's selector, then submits.
 *
 * `holder` is a user's display name, or `'Hosta'` for a guest — the visible
 * option text, so this reads like the thing a person does.
 *
 * A holder with a plate on file now has it appended to the option's label
 * (`holder-fields.tsx`, "Jana Nováková — 1AB 2345"), so `selectOption({
 * label })`'s exact match no longer finds it. This finds the `<option>` whose
 * label is `holder` on its own, or `holder` followed by " — <plate>" — a
 * plain substring match on `holder` alone is not enough, since "Dev User" is
 * also a prefix of the seeded "Dev User Two" — and selects it by value.
 */
export async function reserveSpotFor(
  page: Page,
  label: string,
  holder: string,
  guestName?: string
): Promise<void> {
  const dialog = await openSpot(page, label);
  const select = dialog.getByLabel('Rezervovat pro');
  const escaped = holder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = await select
    .locator('option', { hasText: new RegExp(`^${escaped}( — .*)?$`) })
    .getAttribute('value');
  await select.selectOption(value ?? holder);
  if (guestName !== undefined) {
    await dialog.getByLabel('Jméno hosta').fill(guestName);
  }
  await dialog.getByRole('button', { name: 'Rezervovat', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Cancels the reservation on `label` — as its holder, or as an admin. */
export async function cancelReservation(page: Page, label: string): Promise<void> {
  const dialog = await openSpot(page, label);
  await dialog.getByRole('button', { name: 'Zrušit rezervaci' }).click();
  await expect(dialog).toBeHidden();
}

/** Joins the queue for an occupied `label`. */
export async function joinQueue(page: Page, label: string): Promise<void> {
  const dialog = await openSpot(page, label);
  await dialog.getByRole('button', { name: 'Přidat se do fronty' }).click();
  await expect(dialog).toBeHidden();
}

/** Asserts the tile shows `name` as the holder. Auto-retries. */
export async function expectHeldBy(page: Page, label: string, name: string): Promise<void> {
  await expect(spotTile(page, label)).toContainText(name);
}

/** Asserts the tile is free — i.e. it offers to be reserved. */
export async function expectFree(page: Page, label: string): Promise<void> {
  await expect(page.getByRole('button', { name: `Rezervovat místo ${label}` })).toBeVisible();
}

/**
 * How long a route may take to appear the **first** time it is visited.
 *
 * The suite starts the **built** app (`web:start`), which compiles nothing on
 * demand — but `reuseExistingServer` is on outside CI, so a run may still meet
 * a `next dev` somebody already had up, and that one does. Measured, not
 * guessed: the dev server logged `GET /settings 200 in 4.9s (compile: 1573ms,
 * proxy.ts: 1177ms, render: 2.2s)` on a machine that was also running three
 * browsers and a webpack watch — over Playwright's 5 s default, which is what
 * made the settings step flaky before this existed. See `doc/decision/0183-*`
 * and `doc/decision/0187-*`.
 *
 * It is deliberately **not** the global `expect` timeout: raising that would
 * make every assertion in the suite wait three times as long to report a real
 * failure. Only the one step that pays a compilation carries the allowance,
 * and the wait is still on a condition — the modal being visible — never on a
 * fixed delay. See `doc/decision/0183-*`.
 */
export const FIRST_ROUTE_VISIT_TIMEOUT_MS = 30_000;

/** Opens the bulk-reservation modal from the lot header's button. */
export async function openBulkModal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Hromadná rezervace' }).click();
}

/**
 * Toggles one day cell in the bulk modal's month grid.
 *
 * Located by its visible day-of-month text inside the grid `<table>`, not by
 * its `aria-label` — that label is a full Czech date string this support
 * file has no formatter for, and the bare number is unique within one
 * month's grid.
 */
export async function selectBulkDay(page: Page, date: DateOnly): Promise<void> {
  const dayOfMonth = String(Number(date.slice(8, 10)));
  await page
    .getByRole('table', { name: 'Výběr dní' })
    .locator('button', { hasText: new RegExp(`^${dayOfMonth}$`) })
    .click();
}

/** Picks who the batch is for, from the admin-only "Rezervovat pro" select. */
export async function pickBulkHolder(page: Page, name: string): Promise<void> {
  await page.getByLabel('Rezervovat pro').selectOption({ label: name });
}

export async function generateBulkSchedule(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Vygenerovat rozvrh/ }).click();
}

/**
 * Reads the spot label the result step shows for one day, off
 * `CalendarTable`'s rendered row — the label the confirmation actually
 * assigned, which a bulk booking never predicts ahead of time (the allocator
 * picks the spot; nothing in the flow lets a caller name one).
 */
export async function bulkResultSpotLabel(page: Page, date: DateOnly): Promise<string> {
  const row = page.getByRole('listitem').filter({ hasText: dayAndMonthCzech(date) });
  const label = await row.locator('span.font-bold').first().textContent();
  if (label === null) {
    throw new Error(`No spot label found for ${date} in the bulk result.`);
  }
  return label.trim();
}

export async function confirmBulkSchedule(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Potvrdit rozvrh' }).click();
  // Confirmation is async; wait for the result step (the "Hotovo" button)
  // before returning, so callers reading the result step (e.g.
  // `bulkResultSpotLabel`) never race the still-mounted preview step, which
  // renders the same row markup.
  await page.getByRole('button', { name: 'Hotovo' }).waitFor({ state: 'visible' });
}

export async function closeBulkResult(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Hotovo' }).click();
}

/**
 * Opens Nastavení from the user menu and returns the modal.
 *
 * Settings is a route rendered as a modal over whatever is underneath
 * (`doc/decision/0150-*`), so this waits for the URL first: a `/settings` that
 * never arrives and a modal that never renders are different failures, and the
 * report should say which one happened.
 */
export async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Uživatelské menu' }).click();
  await page.getByRole('menuitem', { name: 'Nastavení (SPZ auta)' }).click();
  await page.waitForURL('**/settings', { timeout: FIRST_ROUTE_VISIT_TIMEOUT_MS });

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: FIRST_ROUTE_VISIT_TIMEOUT_MS });
  await expect(dialog).toContainText('Nastavení');
  return dialog;
}
