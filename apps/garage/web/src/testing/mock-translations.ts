/**
 * A test-only stand-in for what `useTranslations()` (from `@garage/i18n`,
 * re-exported from `next-intl`) returns: a function of `(key, substitutes)`.
 * Instead of resolving `key` against `messages/cs.json`, it echoes `key`
 * itself — with `substitutes` folded in, since a component may pass
 * interpolation values the assertion still needs to see — so a spec can
 * assert on the message key it expects rather than the Czech sentence
 * behind it. A copy edit in `cs.json` should never fail a test that isn't
 * about copy.
 *
 * Used via `jest.mock('next-intl', () => ({ ...jest.requireActual('next-intl'),
 * useTranslations: () => mockedT }))` in a spec file that wants this —
 * see `apps/garage/web/src/lot/spot-dialog/spot-dialog-failures.spec.tsx`.
 */
export type Substitutes = Record<string, string | number>;

export function mockedT(key: string, substitutes?: Substitutes): string {
  if (!substitutes || Object.keys(substitutes).length === 0) {
    return key;
  }
  const parts = Object.entries(substitutes).map(([name, value]) => `${name}=${value}`);
  return `${key}: ${parts.join(',')}`;
}
