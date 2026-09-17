'use client';

/**
 * The one-sentence notice about a month's reservation window
 * (`doc/design/screens/06-admin-overview.png` — the green band under the date).
 *
 * Markup only. Which sentence, which colour and which glyph is
 * {@link toAdminWindowBannerView}'s decision, including the rule this banner
 * exists to protect: a forced lock mode must never quote a date, because the
 * date is the range the automatic rule *would* have produced and saying it
 * aloud would state something untrue.
 */

import type { MonthWindowOverview } from '@garage/contract';
import { Toast } from '@garage/design-system/primitives';
import { useDateFormatters, useTranslations } from '@garage/i18n';
import { toAdminWindowBannerView } from './window-view';

export interface WindowBannerProps {
  readonly window: MonthWindowOverview;
}

export function WindowBanner({ window: month }: WindowBannerProps) {
  const t = useTranslations('admin');
  const f = useDateFormatters();
  const banner = toAdminWindowBannerView(month, f);

  return (
    <Toast tone={banner.tone} icon={banner.glyph}>
      {t(banner.messageKey, banner.values)}
    </Toast>
  );
}
