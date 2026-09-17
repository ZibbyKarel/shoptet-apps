'use client';

/**
 * What `/admin` renders, given a profile — and nothing about how the profile
 * is obtained.
 *
 * Split out of `app/(app)/admin/page.tsx` for the same reason `TopBar` is
 * split from `AppTopBar`: the *rules* (which of the four states is shown, and
 * on what) belong somewhere a test can reach without a session, a query client
 * and a live API. The page keeps the wiring and has no branches of its own.
 *
 * The five tab bodies arrive as {@link AdminScreenProps.panels} rather than
 * being imported here, for the same reason: each of them is a connected
 * component that fetches, and this file has to stay renderable with nothing but
 * an `IntlProvider`. React elements are inert until rendered, so passing all
 * five costs nothing — `Tabs` mounts only the selected one.
 *
 * The role gate here is a **courtesy**, not the enforcement. Authorization
 * lives on the API, where every admin procedure carries `@Roles('ADMIN')` and
 * `RolesGuard` answers 403 regardless of what any browser believes
 * (`doc/auth.md`). What it does is stop a non-admin who typed the URL from
 * staring at an empty screen wondering why nothing loads — and it fails closed:
 * an unknown role (the profile is still in flight, or it failed) is not an
 * admin.
 */

import type { ReactNode } from 'react';
import type { UserRole } from '@lets-park/contract';
import { useTranslations } from '@lets-park/i18n';
import { Stack, Tabs, Text } from '@lets-park/design-system/primitives';
import { EmptyState } from '@lets-park/design-system/compounds';
import { ScreenError, ScreenLoading } from '../screen-state/screen-state';

/** The body of each tab, in the order the design's strip lists them. */
export interface AdminPanels {
  readonly overview: ReactNode;
  readonly users: ReactNode;
  readonly spots: ReactNode;
  readonly window: ReactNode;
  readonly limits: ReactNode;
}

export interface AdminScreenProps {
  /** The caller's role, or `undefined` while it is not known. */
  readonly role: UserRole | undefined;
  /** The profile has not arrived yet. */
  readonly isPending: boolean;
  /** The profile could not be loaded. */
  readonly isError: boolean;
  /** Whatever the failing call threw. See `ScreenErrorProps.error`. */
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly panels: AdminPanels;
}

export function AdminScreen({
  role,
  isPending,
  isError,
  error,
  onRetry,
  panels,
}: AdminScreenProps) {
  const errors = useTranslations('errors');
  const sections = useTranslations('sections');
  const t = useTranslations('admin');

  if (isPending) {
    return <ScreenLoading />;
  }

  if (isError) {
    return <ScreenError error={error} onRetry={onRetry} headingLevel={2} />;
  }

  if (role !== 'ADMIN') {
    return <EmptyState title={errors('FORBIDDEN')} headingLevel={2} />;
  }

  return (
    <>
      {/*
        `mt-2 mb-6` on the heading below was the gap between the eyebrow and
        the title *and* the gap after the title before the tab strip — `Text`
        emits no margin of its own, so both are now `Stack spacing`: one
        wrapping the pair, one after it.
      */}
      <Stack spacing={6}>
        <Stack spacing={2}>
          <Text size="xs" weight="bold" tone="subtle" tracking="caps" transform="uppercase">
            {t('eyebrow')}
          </Text>
          <Text as="h1" size="3xl" weight="bold" tracking="tight">
            {sections('administration')}
          </Text>
        </Stack>
        <Tabs
          label={t('tabsLabel')}
          items={[
            { id: 'overview', label: t('tabOverview'), content: panels.overview },
            { id: 'users', label: t('tabUsers'), content: panels.users },
            { id: 'spots', label: t('tabSpots'), content: panels.spots },
            { id: 'window', label: t('tabWindow'), content: panels.window },
            { id: 'limits', label: t('tabLimits'), content: panels.limits },
          ]}
        />
      </Stack>
    </>
  );
}
