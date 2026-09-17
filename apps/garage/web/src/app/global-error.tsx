'use client';

import { Container } from '@garage/design-system/primitives';
import { IntlProvider, negotiateLocale } from '@garage/i18n';
import { ScreenError } from '../shell/screen-state/screen-state';
import cs from '../../messages/cs.json';
import en from '../../messages/en.json';
import './global.css';

/**
 * The only thing that catches an error thrown by `RootLayout` itself.
 *
 * `./error.tsx` covers pages and nested layouts, but a throw from the root
 * layout happens *above* it — there is no boundary left inside the tree, so
 * Next.js falls through to `global-error`. That is not a theoretical path
 * here: `layout.tsx` does `await auth()`, and Auth.js throws on a session
 * cookie encrypted with an `AUTH_SECRET` that has since been rotated. Every
 * visitor with a stale cookie hits it at once, which is exactly when the app
 * should not drop out of the visitor's language — and without this file
 * Next.js's own built-in error page (English, unstyled by us) is what they
 * would get.
 *
 * **It replaces the root layout**, so it has to render `<html>` and `<body>`
 * itself and pull in the stylesheet: none of the document the root layout
 * would have produced exists at this point.
 *
 * The copy still comes from the catalogue rather than being hard-coded.
 * `IntlProvider` is *handed* its locale, time zone and messages
 * (`libs/shared/i18n/src/lib/provider.tsx`) and needs nothing from a server, so the
 * one provider that *can* be re-established here is re-established, and the
 * translated UI holds at the moment nothing else is working. The cookie the
 * switcher writes is deliberately not read here: the failure being caught may
 * *be* a bad cookie, so the browser's own preference is the safer source. The
 * other providers (session, query, socket) are deliberately absent — this
 * screen asks nothing of the API.
 *
 * **Nothing about the error is rendered**, for the same reason as `./error.tsx`:
 * `ScreenError` keys its copy off the contract's error code and falls back to
 * one generic sentence from the catalogue, so no `message`, no stack and no
 * `digest` reaches the page. The full error stays in the server log.
 *
 * `reset()` re-renders the root segment, which is what `ScreenError`'s retry
 * runs — the right affordance when the cause was transient, and harmless when
 * it was not.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  // `global-error` replaces the root layout, so there is no server-resolved
  // locale and no `<html lang>` to read one from: this is the one place the
  // locale is negotiated in the browser, from the same rule the server uses.
  // `typeof navigator` guarded: this is a client component, but Next still
  // renders it on the server, where `navigator` does not exist.
  const locale = negotiateLocale({
    acceptLanguage: typeof navigator === 'undefined' ? null : navigator.language,
  });
  const messages = locale === 'en' ? en : cs;

  return (
    <html lang={locale}>
      <body>
        <IntlProvider locale={locale} messages={messages}>
          <main>
            <Container padding={[16, 4]}>
              <ScreenError error={error} onRetry={reset} />
            </Container>
          </main>
        </IntlProvider>
      </body>
    </html>
  );
}
