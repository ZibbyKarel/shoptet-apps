/**
 * The only place a message catalog is read.
 *
 * A static import per locale rather than a computed `import(`./${locale}.json`)`:
 * the set of locales is closed (`LOCALES`), a computed specifier defeats
 * bundling, and a missing file should be a build error rather than a runtime
 * 500 on somebody's first page load.
 */

import type { AppMessages, Locale } from '@garage/i18n';
import cs from '../../messages/cs.json';
import en from '../../messages/en.json';

const CATALOGS: Readonly<Record<Locale, AppMessages>> = { cs, en };

/**
 * The catalog for one locale.
 *
 * `async` even though nothing awaits: the root layout is already async, and
 * keeping the signature promise-shaped means switching to per-locale dynamic
 * imports later is not a caller-visible change.
 */
export async function loadMessages(locale: Locale): Promise<AppMessages> {
  return CATALOGS[locale];
}
