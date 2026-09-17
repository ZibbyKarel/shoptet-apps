/**
 * The locale, negotiated in a real browser.
 *
 * The locale for one request comes from the `NEXT_LOCALE` cookie the switcher
 * writes or, failing that, from `Accept-Language`
 * (`apps/garage/web/src/i18n/resolve-locale.ts` → `negotiateLocale` in `libs/shared/i18n`).
 * Both halves are unit-tested, and neither unit can see the seam this file is
 * about: that a language chosen in the menu **survives a reload and a fresh
 * document request**, while the browser keeps asking for something else in
 * every request header. Only a browser can show that.
 *
 * It is also the one spec that does not run in Czech. Every other spec inherits
 * `locale: 'cs-CZ'` from `playwright.config.mts` and asserts Czech copy — as
 * does `support/oidc-login.ts`, which waits for the button named
 * `Uživatelské menu` — so that line is load-bearing for the whole suite and
 * this file deliberately does not touch it. It builds each context by hand
 * instead: `test.use({ locale })` never reaches a context created with
 * `browser.newContext()`, which is how `support/fixtures.ts` and this file make
 * a signed-in page, so a `test.use` here would be silently ignored.
 *
 * ## What every assertion is pinned to
 *
 * `<html lang>` proves the negotiation; a piece of copy proves the *catalog*
 * that was loaded with it. The copy below is quoted from
 * `apps/garage/web/messages/{cs,en}.json`, and the key is named so a rename is
 * traceable: `nav.userMenu`, `nav.language`, `lot.previousDay`,
 * `settings.title`.
 *
 * The switcher's own entries are the exception and are never asserted on:
 * `LOCALE_LABELS` in `libs/shared/i18n` is intentionally endonymic (`Čeština`,
 * `English`) and identical in both catalogs, so it is safe to *click* in any
 * locale and worthless as evidence of one.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import { storageStatePath, USER } from './support/personas';
import { LOT_PATH } from './support/oidc-login';
import { FIRST_ROUTE_VISIT_TIMEOUT_MS } from './support/lot-page';

/** Copy that only exists in one catalog, by key. */
const COPY = {
  /** `nav.userMenu` — the top-bar button, present on every signed-in screen. */
  userMenu: { cs: 'Uživatelské menu', en: 'User menu' },
  /** `nav.language` — the group header inside the open user menu. */
  language: { cs: 'Jazyk', en: 'Language' },
  /** `lot.previousDay` — body copy on the lot, below the top bar. */
  previousDay: { cs: 'Předchozí den', en: 'Previous day' },
  /** `settings.title` — the settings modal's own title. */
  settingsTitle: { cs: 'Nastavení', en: 'Settings' },
} as const;

/**
 * A signed-in page whose browser asks for `locale`.
 *
 * The storage state is the one `support/auth.setup.ts` produced; this is a
 * read-only consumer of that file and never writes it back. The context is
 * built here rather than taken from `support/fixtures.ts` for the single
 * reason that the locale has to be set in the same call as the storage state.
 */
async function signedInPage(
  browser: Browser,
  locale: string,
  body: (page: Page) => Promise<void>
): Promise<void> {
  const context = await browser.newContext({
    storageState: storageStatePath(USER),
    locale,
  });
  try {
    await body(await context.newPage());
  } finally {
    await context.close();
  }
}

/** Asserts the document language and one piece of copy from each catalog. */
async function expectLocale(page: Page, locale: 'cs' | 'en'): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.getByRole('button', { name: COPY.userMenu[locale] })).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.previousDay[locale] })).toBeVisible();
}

test.describe('the language a browser asks for', () => {
  test('a Czech browser gets the Czech UI', async ({ browser }) => {
    await signedInPage(browser, 'cs-CZ', async (page) => {
      await page.goto(LOT_PATH);
      await expectLocale(page, 'cs');
    });
  });

  test('an English browser gets the English UI', async ({ browser }) => {
    await signedInPage(browser, 'en-GB', async (page) => {
      await page.goto(LOT_PATH);
      await expectLocale(page, 'en');
    });
  });

  // A product decision, not an approximation: Slovak and Czech are mutually
  // intelligible, so a Slovak browser gets the Czech UI rather than English.
  test('a Slovak browser gets the Czech UI, not English', async ({ browser }) => {
    await signedInPage(browser, 'sk-SK', async (page) => {
      await page.goto(LOT_PATH);
      await expectLocale(page, 'cs');
    });
  });

  test('a browser asking for neither gets the English UI', async ({ browser }) => {
    await signedInPage(browser, 'de-DE', async (page) => {
      await page.goto(LOT_PATH);
      await expectLocale(page, 'en');
    });
  });
});

test.describe('the language a person chooses', () => {
  /**
   * The acceptance criterion no unit test reaches.
   *
   * The browser asks for Czech in *every* request here, so English can only
   * come from the cookie the switcher wrote — and it has to keep coming from
   * it after `reload()` (a fresh document under the same header) and after a
   * navigation to another route. Drop the cookie branch from
   * `negotiateLocale` and this test fails at the first assertion after the
   * switch, because the header alone says Czech.
   */
  test('English survives a reload and a navigation, against a Czech browser', async ({
    browser,
  }) => {
    // Two switches, two reloads and four document loads of a production build,
    // one of them the settings route whose first visit carries the allowance
    // `FIRST_ROUTE_VISIT_TIMEOUT_MS` exists for. The default 30 s test timeout
    // is the wrong budget for that, and `slow()` raises it without touching
    // any assertion's own timeout.
    test.slow();

    await signedInPage(browser, 'cs-CZ', async (page) => {
      await page.goto(LOT_PATH);
      await expectLocale(page, 'cs');

      await page.getByRole('button', { name: COPY.userMenu.cs }).click();
      // The group header, in Czech, is what says the *menu* is still Czech at
      // the moment of the choice — the entries themselves are endonyms.
      await expect(page.getByText(COPY.language.cs)).toBeVisible();
      await page.getByRole('menuitemradio', { name: 'English' }).click();

      // `router.refresh()`, so the switch itself is a re-render, not a load.
      await expectLocale(page, 'en');

      await page.reload();
      await expectLocale(page, 'en');

      // A fresh document request for another route, which is where a
      // cookie-negotiated scheme with no locale in the URL either works or
      // does not. `goto` rather than the menu entry: the menu entry's copy is
      // itself locale-dependent, and this step is about the negotiation.
      await page.goto('/settings');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: FIRST_ROUTE_VISIT_TIMEOUT_MS });
      await expect(dialog).toContainText(COPY.settingsTitle.en);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');

      // And back, so the switcher is shown to work in both directions rather
      // than only away from the default. Back on the lot first: settings is a
      // modal with a scrim over the top bar, and the user menu underneath it
      // is not clickable — measured, as a 30 s hang on exactly that click.
      //
      // This direction is corroboration, not proof: `cs` is also what the
      // header alone would give, so it says the second cookie write took
      // effect, and the `cs-CZ` → `en` half above is what proves persistence.
      await page.goto(LOT_PATH);
      await page.getByRole('button', { name: COPY.userMenu.en }).click();
      await expect(page.getByText(COPY.language.en)).toBeVisible();
      await page.getByRole('menuitemradio', { name: 'Čeština' }).click();

      await expectLocale(page, 'cs');

      await page.reload();
      await expectLocale(page, 'cs');
    });
  });
});
