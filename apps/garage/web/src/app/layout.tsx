import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { auth } from '../auth';
import { apiOriginOrEmpty } from '../api-url';
import { loadMessages } from '../i18n/load-messages';
import { resolveRequestLocale } from '../i18n/resolve-locale';
import { Providers } from './providers';
import type csMessages from '../../messages/cs.json';
import './global.css';

/**
 * The document, and nothing else.
 *
 * Everything with an opinion about layout lives one level down: `(app)/layout`
 * draws the top bar for signed-in screens, and `login/page` draws its own
 * full-height canvas. This file only establishes the language
 * (negotiated per request — see `../i18n/resolve-locale.ts`), the stylesheet
 * (which is what wires in the design tokens and the fonts — see
 * `./global.css`) and the client provider boundary.
 */

/**
 * Read on the server before any provider exists, so it goes to the catalog
 * directly rather than through `useTranslations` — same JSON, no React.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  const messages = (await loadMessages(locale)) as typeof csMessages;

  return {
    title: messages.shell.brand,
    description: messages.shell.metaDescription,
  };
}

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  // Read once, on the server, and handed to `AuthProvider` so the first client
  // render matches the server one instead of flashing "loading" and bouncing a
  // signed-in visitor to Okta. `null` and *absent* mean different things to
  // Auth.js; `auth()` returns `null` for "no session, I checked", which is
  // exactly the distinction `AuthProviderProps.session` documents.
  const session = await auth();

  // Read here rather than in the client component: this is the value
  // `webEnvSchema` validated at boot, so the browser gets the same string the
  // server did without a second, unvalidated `process.env` read.
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';

  // The document's language, and the catalog every client component below
  // reads through `IntlProvider`. Resolved here because this is the only
  // component that runs on the server above the client boundary — see
  // `../i18n/resolve-locale.ts`.
  const locale = await resolveRequestLocale();
  const messages = await loadMessages(locale);

  return (
    <html lang={locale}>
      <body>
        <Providers
          session={session}
          apiUrl={apiUrl}
          socketUrl={apiOriginOrEmpty(apiUrl)}
          locale={locale}
          messages={messages}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
