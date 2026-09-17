'use client';

/**
 * `admin.user.list`, wired for one of `LotScreen`'s two holder pickers.
 *
 * Both the "reserve for" picker (`holderQuery`) and the "queue for" picker
 * (`queueTargetQuery`) fetch the same procedure and only ever differ in what
 * they ask for (`input`) and when they may ask at all (`enabled`). What they
 * must not differ in is the one invariant that is easy to get wrong twice:
 * **a disabled query never leaves `isPending`** — `status` starts at
 * `'pending'` and only a fetch can move it, so a query gated `enabled: false`
 * reports `isPending: true` forever. Reading `isPending`/`isError` unguarded
 * would therefore disable a normal user's button and show them an error that
 * never resolves. Gating both flags on the same condition that gates
 * `enabled` is the fix, and this hook is where that gating happens exactly
 * once — see `enabled`'s doc comment below for why the session check is not
 * part of it.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@garage/auth/client';
import type { AdminListUsersInput } from '@garage/contract';
import type { HolderOption } from './spot-dialog/holder-input';
import { useApi } from '../shell/api-provider/api-provider';
import { toHolderOptions } from './lot-view';

export interface UseAdminUserOptionsParams {
  readonly input: AdminListUsersInput;
  /**
   * Whether the caller wants this list at all — `isAdmin` for the holder
   * picker, `isAdmin && openSpot !== null && openSpot.action === 'queue'` for
   * the queue-target one. The query's actual `enabled` is this **and** an
   * authenticated session, same as every other query on this screen (firing
   * before the session exists spends a request the API answers 401, and a 401
   * is not retried); the `sessionStatus` half is deliberately excluded from
   * `pending`/`error`'s gating, matching this hook's two call sites before
   * the extraction — both flags are read as `enabled && …`, not
   * `sessionStatus === 'authenticated' && enabled && …`.
   */
  readonly enabled: boolean;
}

export interface UseAdminUserOptionsResult {
  readonly options: readonly HolderOption[];
  readonly pending: boolean;
  readonly error: unknown;
}

/** One admin-only holder picker's data, and nothing about which picker it is. */
export function useAdminUserOptions({
  input,
  enabled,
}: UseAdminUserOptionsParams): UseAdminUserOptionsResult {
  const api = useApi();
  const { status: sessionStatus } = useSession();

  const query = useQuery({
    ...api.admin.user.list.queryOptions({ input }),
    enabled: sessionStatus === 'authenticated' && enabled,
  });

  const pending = enabled && query.isPending;
  const error = enabled && query.isError ? query.error : null;

  const options = useMemo(() => toHolderOptions(query.data?.users ?? []), [query.data]);

  return { options, pending, error };
}
