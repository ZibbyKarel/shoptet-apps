'use client';

/**
 * Who is signed in, as the **API** understands it.
 *
 * The Auth.js session carries the identity Okta asserted — a name and an email
 * — and nothing else. It deliberately does not carry a role: roles live in this
 * application's own `User` row, which is created on the caller's first ever
 * request by just-in-time provisioning (`doc/auth.md`, §Just-in-time
 * provisioning), and `libs/garage/auth`'s `projectSession` copies only the access
 * token onto what the browser may see.
 *
 * So the role comes from the contract, through `me.get`, like every other piece
 * of application data. That is also why the top bar's `ADMIN` badge and its
 * `Správa` entry appear a moment after the name does, and why both are absent
 * while the query is in flight: unknown means not an admin, which is the only
 * safe direction for a check to fail in. Nothing is *authorised* here — the API
 * enforces `@Roles('ADMIN')` on every admin procedure regardless of what this
 * hook returned.
 */

import { useSession } from '@garage/auth/client';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { MyProfile } from '@garage/contract';
import { useApi } from './api-provider/api-provider';

/** The caller's own profile row. Idle until there is a session to send. */
export function useCurrentUser(): UseQueryResult<MyProfile> {
  const api = useApi();
  const { status } = useSession();

  return useQuery({
    ...api.me.get.queryOptions(),
    // Firing before the session exists just spends a request the API is going
    // to answer 401, and a 401 is not retried (`shouldRetryQuery`), so the
    // screen would settle into an error state that a signed-in user never
    // leaves.
    enabled: status === 'authenticated',
  });
}
