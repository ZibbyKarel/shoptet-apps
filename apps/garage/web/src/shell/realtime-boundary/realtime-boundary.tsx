'use client';

/**
 * The one Socket.io connection, held closed until there is a session to
 * present.
 *
 * `RealtimeProvider` does the work; this file exists only to feed it the two
 * things it cannot know on its own — the current session's status and the
 * token provider — without any screen having to. Connecting before a session
 * exists just spends a handshake the gateway is going to refuse
 * (`doc/realtime.md`).
 *
 * The token reaches the gateway through `socket.handshake.auth`, never a query
 * string; that is `libs/garage/realtime-client`'s job and nothing here routes around
 * it (`doc/decision/0060-*`).
 */

import type { ReactNode } from 'react';
import { useAccessTokenProvider, useSession } from '@garage/auth/client';
import { RealtimeProvider } from '@garage/realtime-client';

export interface RealtimeBoundaryProps {
  /**
   * **Origin** of the API — no path. Socket.io reads a path in the URL as a
   * namespace; see `apiOriginOf` in `../../api-url.ts`.
   */
  readonly url: string;
  readonly children: ReactNode;
}

export function RealtimeBoundary({ url, children }: RealtimeBoundaryProps) {
  const { status } = useSession();
  const getAccessToken = useAccessTokenProvider();

  return (
    <RealtimeProvider
      url={url}
      getAccessToken={getAccessToken}
      // An empty origin is the build-time render with no environment (see
      // `app/layout.tsx`). Dialling `io('')` would connect to the page's own
      // origin, which is not the API — staying closed is the honest answer.
      enabled={status === 'authenticated' && url !== ''}
      // A payload that fails its contract schema is dropped by the lib. Saying
      // so out loud is the difference between "the board stopped updating" and
      // a report naming the event and the issues. The report carries the event
      // name and Zod's issues — never a token; nothing about the handshake
      // reaches this callback.
      //
      // `no-console` is enforced in `apps/garage/api/**` and `libs/**` only
      // (`eslint.config.mjs`); `apps/garage/web` has no logger of its own, and a
      // dropped payload with nothing said about it is the failure this avoids.
      onInvalidPayload={(report) => {
        console.warn('Realtime payload rejected by its contract schema', report);
      }}
    >
      {children}
    </RealtimeProvider>
  );
}
