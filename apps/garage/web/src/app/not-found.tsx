'use client';

import NextLink from 'next/link';
import { EmptyState } from '@garage/design-system/compounds';
import { Container, Link } from '@garage/design-system/primitives';
import { useTranslations } from '@garage/i18n';
import { LOT_ROUTE } from '../routes';

/**
 * The 404. Rendered inside the root layout, so it already has the providers —
 * which is what lets it read Czech copy rather than shipping Next.js's English
 * default page.
 *
 * The way back is a **link**, not a `Button`: it is a navigation, so it should
 * be openable in a new tab and readable as a link by assistive technology.
 * `Button` takes no `href` and wrapping one in an anchor would nest two
 * interactive elements — the design draws no 404 screen to copy either way, so
 * this follows the same "invented, in the design's language" rule `EmptyState`
 * itself was built under (`doc/decision/0071-*`).
 *
 * The design-system `Link` primitive owns exactly this treatment (rounded
 * focus ring, brand-blue underline, bold) — `as={NextLink}` is what keeps
 * this rendering through `next/link` (as it always did) instead of falling
 * back to a plain `<a>`, so client-side navigation is unchanged.
 */
export default function NotFound() {
  const t = useTranslations('shell');

  return (
    <main>
      <Container padding={[16, 4]}>
        <EmptyState
          headingLevel={2}
          title={t('notFoundTitle')}
          description={t('notFoundDescription')}
          action={
            <Link as={NextLink} href={LOT_ROUTE}>
              {t('backToLot')}
            </Link>
          }
        />
      </Container>
    </main>
  );
}
