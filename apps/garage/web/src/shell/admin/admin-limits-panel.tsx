'use client';

/**
 * `AdminLimitsScreen`, connected to the API. Wiring only — the same split as
 * `admin-window-panel.tsx`, and for the same reason: every rule lives in the
 * screen, every fetch in here.
 */

import { useState } from 'react';
import { useRequireAuth } from '@garage/auth/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReservationLimitSettings } from '@garage/contract';
import { useApi } from '../api-provider/api-provider';
import { screenDataOf } from '../screen-state/screen-state';
import { AdminLimitsScreen } from './admin-limits-screen/admin-limits-screen';

export function AdminLimitsPanel() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();

  // `true` only between a successful save and the next change, so the "uloženo"
  // confirmation appears for the save that just happened and not for one from
  // five minutes ago.
  const [isSaved, setIsSaved] = useState(false);

  const limitsQuery = useQuery({
    ...api.admin.reservationLimits.get.queryOptions(),
    enabled: status === 'authenticated',
  });

  const updateLimits = useMutation({
    ...api.admin.reservationLimits.update.mutationOptions(),
    onSuccess: () => {
      setIsSaved(true);
      // The admin screen's own query.
      queryClient.invalidateQueries({ queryKey: api.admin.reservationLimits.key() });
      // Every month summary carries the cap in force, and the bulk modal's
      // greyed-out cells are derived from it — so they are stale the moment
      // the cap changes. `api.reservation.key()` covers `myMonth`, and
      // `api.admin.reservation.key()` the holder-scoped summary.
      queryClient.invalidateQueries({ queryKey: api.reservation.key() });
      queryClient.invalidateQueries({ queryKey: api.admin.reservation.key() });
    },
  });

  return (
    <AdminLimitsScreen
      limits={screenDataOf(limitsQuery)}
      onRetry={() => void limitsQuery.refetch()}
      onChange={(next: ReservationLimitSettings) => {
        setIsSaved(false);
        updateLimits.reset();
        updateLimits.mutate(next);
      }}
      isSaving={updateLimits.isPending}
      saveError={updateLimits.error}
      isSaved={isSaved}
    />
  );
}
