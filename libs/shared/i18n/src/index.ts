/**
 * `@garage/i18n` — the only place in the workspace allowed to import
 * `next-intl` (enforced in `eslint.config.mjs`, see `doc/i18n.md`).
 *
 * Re-exports `libs/garage/shared-types`' Europe/Prague date logic (holidays,
 * weekends, `DateOnly` arithmetic) under the same names, per
 * `doc/decision/0003-date-helpers-in-shared-types.md`, so feature code never
 * has to import `@garage/shared-types` directly for that.
 */
export * from '@garage/shared-types';

export * from './lib/errors';
export * from './lib/dates';
export * from './lib/date-formatters';
export * from './lib/locale';
export * from './lib/provider';

/**
 * Re-exported so components already wrapped in `IntlProvider` can read
 * messages and format values without a second, direct `next-intl` import —
 * this lib stays the only allowed import site for the package itself.
 */
export { useTranslations, useFormatter, useLocale } from 'next-intl';
