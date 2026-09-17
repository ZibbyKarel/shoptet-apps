'use client';

/**
 * `AdminUsersScreen`, connected to the API. Wiring only.
 *
 * The list is fetched unfiltered — no `role`, no `active`, no `search` — because
 * the table shows every account and filters in the browser
 * (`doc/decision/0162-*`). The contract's filters stay available for a caller
 * that needs them.
 */

import { useState } from 'react';
import { useRequireAuth } from '@garage/auth/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api-provider/api-provider';
import { screenDataOf } from '../screen-state/screen-state';
import { useCurrentUser } from '../use-current-user';
import { AdminUsersScreen, type PendingUserChange } from './admin-users-screen/admin-users-screen';

export function AdminUsersPanel() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();
  const viewer = useCurrentUser();

  // Which row and field the in-flight mutation belongs to. TanStack's own
  // `isPending` says *that* something is in flight, not *what* — and the table
  // needs to disable exactly one row's switches, not all of them.
  const [pendingChange, setPendingChange] = useState<PendingUserChange | null>(null);

  const usersQuery = useQuery({
    ...api.admin.user.list.queryOptions({ input: {} }),
    enabled: status === 'authenticated',
  });

  const updateUser = useMutation({
    ...api.admin.user.update.mutationOptions(),
    onSettled: () => {
      setPendingChange(null);
      // Refetch rather than patch the cache: the API is the authority on what a
      // change actually did (it can refuse the last-admin cases), so the row
      // must come back from it and not from an optimistic guess here.
      queryClient.invalidateQueries({ queryKey: api.admin.user.key() });
    },
  });

  return (
    <AdminUsersScreen
      users={screenDataOf(usersQuery)}
      onRetry={() => void usersQuery.refetch()}
      viewerId={viewer.data?.id}
      onRoleChange={(id, isAdmin) => {
        // `reset()` before every attempt: a mutation keeps its `error` until it
        // is cleared, so without this the next *successful* toggle would still
        // render the previous failure's sentence.
        updateUser.reset();
        setPendingChange({ id, field: 'role' });
        updateUser.mutate({ id, role: isAdmin ? 'ADMIN' : 'USER' });
      }}
      onActiveChange={(id, active) => {
        updateUser.reset();
        setPendingChange({ id, field: 'active' });
        updateUser.mutate({ id, active });
      }}
      pendingChange={pendingChange}
      updateError={updateUser.error}
    />
  );
}
