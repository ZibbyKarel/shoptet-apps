/**
 * What a locale *is* in this application, and how one is chosen.
 *
 * Deliberately free of `next-intl`: both the server (`apps/garage/web`'s root layout,
 * reading a cookie and a request header) and the client (`app/global-error.tsx`,
 * reading `navigator.language` with no layout above it) need this answer, and
 * neither should have to stand up an intl runtime to get it.
 *
 * The Slovak rule is a product decision, not an approximation: a Slovak
 * browser gets the Czech UI (`TODO.md` item 9), because the two are mutually
 * intelligible and a half-translated Slovak catalog would be worse than either.
 */

/** Every locale the UI ships. Czech first: it is the source of truth for keys. */
export const LOCALES = ['cs', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * The locale used when nothing else is known — an absent header, an
 * unparseable one, or a header that asks for neither Czech nor anything else
 * specific. Czech, because this is a Czech company's internal app
 * (`CLAUDE.md`).
 */
export const DEFAULT_LOCALE: Locale = 'cs';

/**
 * The cookie the language switcher writes and the root layout reads.
 *
 * The name is `next-intl`'s own convention, kept even though this app runs no
 * next-intl middleware — if one is ever added, it will look here.
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/**
 * Each locale named in its own language, for the switcher.
 *
 * Endonyms on purpose: a visitor who has landed on the wrong language needs to
 * recognise their own, and "Czech" is no help to someone who only reads Czech.
 */
export const LOCALE_LABELS: Readonly<Record<Locale, string>> = {
  cs: 'Čeština',
  en: 'English',
};

/** Narrows an arbitrary string to a shipped locale. Case-sensitive: cookies we write are lowercase. */
export function isLocale(value: string | undefined | null): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** One `Accept-Language` entry, reduced to what the decision needs. */
interface LanguageRange {
  readonly language: string;
  readonly quality: number;
}

/**
 * Parses `Accept-Language` into primary language subtags with their quality,
 * highest quality first.
 *
 * Only the primary subtag matters here (`cs-CZ` → `cs`), because the choice is
 * between two languages, not between regional variants. A malformed `q` is
 * treated as an absent one (quality 1), which is what browsers send when they
 * mean "most preferred".
 */
function parseAcceptLanguage(header: string): readonly LanguageRange[] {
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qualityParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const parsed = qualityParam === undefined ? Number.NaN : Number(qualityParam.slice(2));
      return {
        language: (tag ?? '').trim().split('-')[0]?.toLowerCase() ?? '',
        quality: Number.isFinite(parsed) ? parsed : 1,
      };
    })
    .filter((range) => range.language !== '' && range.quality > 0)
    .sort((a, b) => b.quality - a.quality);
}

/**
 * The locale for one request or one page load.
 *
 * A valid cookie wins outright — it is an explicit choice the visitor made in
 * the switcher, and it must not be overridden by the browser's own preference
 * on the next navigation. Otherwise the browser's languages are read in
 * quality order: Czech *or Slovak* means the Czech UI, any other recognised
 * language means English, and nothing recognisable means {@link DEFAULT_LOCALE}.
 */
export function negotiateLocale({
  cookie,
  acceptLanguage,
}: {
  readonly cookie?: string | null | undefined;
  readonly acceptLanguage?: string | null | undefined;
}): Locale {
  if (isLocale(cookie)) {
    return cookie;
  }

  for (const { language } of parseAcceptLanguage(acceptLanguage ?? '')) {
    if (language === 'cs' || language === 'sk') {
      return 'cs';
    }
    // Any other *named* language means English — the spec's "`en` for
    // everything else" (`TODO.md` item 9), so German, Polish and Portuguese
    // all land here rather than falling through to the Czech default. Only a
    // wildcard (`*`) or a malformed tag keeps looking, and an exhausted list
    // is what {@link DEFAULT_LOCALE} is for.
    if (/^[a-z]{2,3}$/.test(language)) {
      return 'en';
    }
  }

  return DEFAULT_LOCALE;
}
