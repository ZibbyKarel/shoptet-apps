import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './global.css';

/**
 * The document, and nothing else.
 *
 * No providers yet: this app has no session, no API client and no message
 * catalog, so there is nothing for a client boundary to carry. When those
 * arrive, `apps/garage/web/src/app/layout.tsx` is the shape to follow —
 * it reads the session on the server and hands it down so the first client
 * render matches.
 *
 * `lang` is hard-coded. The parking app negotiates it per request
 * (`resolve-locale.ts`); doing that here before any translated copy exists
 * would be machinery with nothing to translate.
 */
export const metadata: Metadata = {
  title: 'Wishlist',
  description: 'Feature requests for shoptet-partner-cli.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
