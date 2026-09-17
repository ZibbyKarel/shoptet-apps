'use client';

/**
 * `SettingsScreen`, connected to the session, the API and the router.
 *
 * Mirrors `AppTopBar`'s split from `TopBar`: every *rule* about what is shown
 * and what a save or a regeneration does lives in `./settings-screen/settings-screen.tsx`,
 * which is why this file is wiring only.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UpdateMySettingsInput } from '@garage/contract';
import { useRequireAuth } from '@garage/auth/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOT_ROUTE } from '../routes';
import { useApi } from './api-provider/api-provider';
import { useCurrentUser } from './use-current-user';
import { SettingsScreen } from './settings-screen/settings-screen';

export interface SettingsPageProps {
  /**
   * Origin of the API (`apiOriginOf(NEXT_PUBLIC_API_URL)`, no path), passed
   * straight through to `SettingsScreen` — building the ICS feed URL (or
   * deciding it cannot be built) is that component's rule, not this file's.
   */
  readonly apiOrigin: string;
}

export function SettingsPage({ apiOrigin }: SettingsPageProps) {
  const router = useRouter();
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();

  const profileQuery = useCurrentUser();
  const spotsQuery = useQuery({
    ...api.spot.list.queryOptions(),
    enabled: status === 'authenticated',
  });

  // The freshly regenerated token, kept locally so the new feed URL renders
  // immediately rather than waiting for `me.get` to refetch after the
  // invalidation below. `undefined` means "still whatever `me.get` returned".
  const [regeneratedToken, setRegeneratedToken] = useState<string | undefined>(undefined);
  const icsToken = regeneratedToken ?? profileQuery.data?.icsToken;

  const updateSettings = useMutation({
    ...api.me.updateSettings.mutationOptions(),
    onSuccess: () => {
      // Every other reader of the profile (the top bar's name/role, this
      // screen if it is reopened) must see the change, not a stale cache entry.
      queryClient.invalidateQueries({ queryKey: api.me.key() });
      router.push(LOT_ROUTE);
    },
  });

  const regenerateToken = useMutation({
    ...api.me.regenerateIcsToken.mutationOptions(),
    onSuccess: (data) => {
      setRegeneratedToken(data.icsToken);
      queryClient.invalidateQueries({ queryKey: api.me.key() });
    },
  });

  return (
    <SettingsScreen
      isPending={profileQuery.isPending}
      isError={profileQuery.isError}
      error={profileQuery.error}
      onRetry={() => void profileQuery.refetch()}
      profile={profileQuery.data}
      spots={spotsQuery.data?.spots ?? []}
      spotsPending={spotsQuery.isPending}
      spotsError={spotsQuery.isError}
      onSave={(input: UpdateMySettingsInput) => updateSettings.mutate(input)}
      isSaving={updateSettings.isPending}
      saveError={updateSettings.error}
      ics={{
        apiOrigin,
        token: icsToken,
        onRegenerate: async () => {
          await regenerateToken.mutateAsync();
        },
        isRegenerating: regenerateToken.isPending,
        regenerateError: regenerateToken.error,
      }}
      onClose={() => router.push(LOT_ROUTE)}
    />
  );
}
