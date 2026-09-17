/**
 * The catalogs are checked against each other, not against a snapshot.
 *
 * `cs.json` is the source of truth for keys (`AppConfig["Messages"]` is
 * augmented from it — `apps/garage/web/next-intl.d.ts`), so a key missing from `en.json`
 * is invisible to TypeScript: next-intl would fall back at runtime and a user
 * would read a Czech sentence in an English UI. That is what these tests
 * exist to stop.
 *
 * This file also carries two guarantees that used to live elsewhere and no
 * longer can, now that the catalogs are JSON instead of a TypeScript object:
 *
 * - `libs/shared/i18n/src/lib/errors.spec.ts` used to iterate the contract's
 *   `ERROR_CODES` against the real catalog and fail on any code with no
 *   message. It cannot any more — `libs/shared/i18n` may not import an app's
 *   catalogs (Nx forbids a lib→app dependency) — so its fixture is now
 *   derived from `ERROR_CODES` itself and the check there is vacuous. The
 *   "translates every contract error code" test below is where that check
 *   now actually happens, for every locale.
 * - The deleted TypeScript catalog declared
 *   `interface CzechErrorMessages extends Record<ErrorCode, string>`, which
 *   made "every contract error code has a Czech message" a **compile-time**
 *   guarantee. JSON cannot carry that on its own, so the `_check`
 *   assertion near the bottom of this file restores it: `cs.errors` must be
 *   assignable to `Record<ErrorCode, string>`, checked by `tsc` because
 *   `apps/garage/web/tsconfig.spec.json` includes `messages/**\/*.spec.ts`.
 */

import { ERROR_CODES, type ErrorCode } from '@garage/contract';
import { LOCALES, useTranslations, type Locale } from '@garage/i18n';
import cs from './cs.json';
import en from './en.json';

const CATALOGS: Readonly<Record<Locale, unknown>> = { cs, en };

type Leaf = readonly [key: string, value: string];

function leaves(value: unknown, prefix = ''): readonly Leaf[] {
  if (typeof value === 'string') {
    return [[prefix.slice(0, -1), value]];
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${prefix}: a catalog holds only strings and nested objects`);
  }
  return Object.entries(value).flatMap(([key, child]) => leaves(child, `${prefix}${key}.`));
}

/** Every ICU argument name in one message, e.g. `{count, plural, …}` → `count`. */
function placeholders(message: string): readonly string[] {
  return [...message.matchAll(/\{\s*([A-Za-z0-9_]+)/g)].map((m) => m[1] ?? '').sort();
}

const catalogLeaves = new Map<Locale, readonly Leaf[]>(
  LOCALES.map((locale) => [locale, leaves(CATALOGS[locale])])
);

it('covers every locale the app can negotiate', () => {
  expect(Object.keys(CATALOGS).sort()).toEqual([...LOCALES].sort());
});

describe.each(LOCALES.filter((locale) => locale !== 'cs'))('%s vs cs', (locale) => {
  const czech = new Map(catalogLeaves.get('cs') ?? []);
  const other = new Map(catalogLeaves.get(locale) ?? []);

  it('has every key Czech has', () => {
    expect([...czech.keys()].filter((key) => !other.has(key))).toEqual([]);
  });

  it('has no key Czech does not have', () => {
    expect([...other.keys()].filter((key) => !czech.has(key))).toEqual([]);
  });

  it('uses the same ICU arguments as Czech in every message', () => {
    const mismatched = [...czech]
      .filter(([key, value]) => {
        const translated = other.get(key);
        return (
          translated !== undefined &&
          placeholders(value).join(',') !== placeholders(translated).join(',')
        );
      })
      .map(([key]) => key);

    expect(mismatched).toEqual([]);
  });
});

describe.each(LOCALES)('%s', (locale) => {
  const entries = catalogLeaves.get(locale) ?? [];

  it('has no empty message', () => {
    expect(entries.filter(([, value]) => value.trim() === '').map(([key]) => key)).toEqual([]);
  });

  it('uses typographic apostrophes only — a straight one is an ICU escape', () => {
    expect(entries.filter(([, value]) => value.includes("'")).map(([key]) => key)).toEqual([]);
  });

  it('translates every contract error code', () => {
    const errors = new Map(
      entries
        .filter(([key]) => key.startsWith('errors.'))
        .map(([key, value]) => [key.slice('errors.'.length), value])
    );

    expect(ERROR_CODES.filter((code: ErrorCode) => !errors.has(code))).toEqual([]);
  });

  it('keeps "not open yet" and "already closed" distinguishable', () => {
    const errors = new Map(
      entries
        .filter(([key]) => key.startsWith('errors.'))
        .map(([key, value]) => [key.slice('errors.'.length), value])
    );

    expect(errors.get('OUT_OF_HORIZON')).not.toBe(errors.get('RESERVATIONS_LOCKED'));
  });
});

it('does not ship an English message that is still the Czech one', () => {
  const czech = new Map(catalogLeaves.get('cs') ?? []);
  const english = new Map(catalogLeaves.get('en') ?? []);

  // Exactly eight values are legitimately byte-identical between the
  // catalogs — a product name, a bare ICU placeholder, an em dash, and
  // English words already used as Czech UI labels. Reviewed and confirmed;
  // do not widen this to make a failure go away — a ninth entry means either
  // the translation regressed or the allowlist is being used to hide it.
  const SHARED = new Set([
    'shell.brand', // "Garage" — a product name, not translated
    'nav.adminBadge', // "Admin" — already English in Czech UI
    'lot.dayCell', // bare "{date}"
    'bulk.dayCell', // bare "{date}"
    'admin.spotsTodayUnknown', // "—" — an em dash, not a word
    'admin.usersColumnAdmin', // "Admin" — already English in Czech UI
    'admin.usersAdminToggleLabel', // "Admin role — {name}" — already English
    'admin.usersColumnEmail', // "E-mail" — already English in Czech UI
  ]);

  const untranslated = [...english]
    .filter(([key, value]) => !SHARED.has(key) && czech.get(key) === value)
    .filter(([, value]) => /\p{L}/u.test(value))
    .map(([key]) => key);

  expect(untranslated).toEqual([]);
});

/**
 * Compile-time restoration of the guarantee the deleted TypeScript catalog
 * gave via `interface CzechErrorMessages extends Record<ErrorCode, string>`:
 * every contract error code has a Czech message. JSON has no interfaces, so
 * this assignment is the closest equivalent — `tsc` fails it if `cs.errors`
 * is ever missing a key `ErrorCode` requires. It is inert at runtime (no
 * assertion, no `it()`) and exists purely for the typecheck program that
 * `apps/garage/web/tsconfig.spec.json` runs over this file.
 */

const _check: Record<ErrorCode, string> = cs.errors;
void _check;

/**
 * Compile-time regression guard for `apps/garage/web/next-intl.d.ts`'s `AppConfig`
 * augmentation — the mechanism that makes `useTranslations`' namespace and
 * key arguments typecheck against `cs.json` in the first place.
 *
 * Nothing else would notice if that augmentation were deleted:
 * `useTranslations` degrades to accepting a plain `string`, and every
 * existing call site still compiles. So this asserts the opposite of the
 * usual case — that a namespace absent from `cs.json` ("noSuchNamespace" is
 * not a key of it, see the destructuring above) is a **type error** to pass
 * to `useTranslations`. Reached through `@garage/i18n`, never `next-intl`
 * directly, per the wrapper rule.
 *
 * If the augmentation ever stops binding, this expression becomes legal,
 * the `@ts-expect-error` directive below becomes unused, and TypeScript
 * flags an unused directive — which fails `web:typecheck`. That failure
 * mode is the point: it is the regression guard.
 *
 * Never called — a function body that is never invoked, so this has no
 * runtime effect and adds no test.
 */
function _neverCalled_augmentationGuard() {
  // @ts-expect-error 'noSuchNamespace' is not a namespace in cs.json — this
  // must not compile while the AppConfig augmentation binds. If it starts
  // compiling, the augmentation stopped working and this directive goes
  // unused, which is itself a typecheck failure.
  useTranslations('noSuchNamespace');
}
void _neverCalled_augmentationGuard;
