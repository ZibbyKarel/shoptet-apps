'use client';

/**
 * The one place that decides where a `Toast` floats.
 *
 * `doc/decision/0055-toast-and-tooltip-are-presentational.md` keeps
 * `Toast`/`ToastRegion` in the design system free of an imperative queue —
 * positioning is a caller decision, not a primitive one. Every action-failure
 * or action-success notice in the app floats top-right (`e0d44b0`, `8794c0c`),
 * so this wrapper fixes that placement and the shared `notificationsRegion`
 * label once, instead of the three-line `<ToastRegion placement="top-right"
 * label={…}>` being copy-pasted at each call site.
 *
 * As of the global `ToastProvider` (`./toast-provider.tsx`), this component is
 * only ever rendered from there — feature code calls `useNotify` instead of
 * importing `AppToastRegion` directly.
 */

import type { ReactNode } from 'react';
import { ToastRegion } from '@lets-park/design-system/primitives';
import { useTranslations } from '@lets-park/i18n';

export interface AppToastRegionProps {
  readonly children?: ReactNode;
}

export function AppToastRegion({ children }: AppToastRegionProps) {
  const tShell = useTranslations('shell');
  return (
    <ToastRegion placement="top-right" label={tShell('notificationsRegion')}>
      {children}
    </ToastRegion>
  );
}
