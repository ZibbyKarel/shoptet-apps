/**
 * The provider stack three specs mount their subject inside.
 *
 * `<QueryClientProvider><ApiProvider><IntlProvider>` was written out
 * byte-identically in `lot/lot-screen/lot-screen.spec.tsx`,
 * `lot/bulk-modal/bulk-modal.spec.tsx` and `app/(app)/layout.spec.tsx`. It is
 * the *order* that matters — `ApiProvider` needs a query client above it, and
 * every Czech string in the tree comes from `IntlProvider`, which this wrapper
 * feeds `messages/cs.json` — and an order nobody can see three copies of at
 * once is an order that drifts.
 *
 * The query client is passed in, never created here: each spec seeds it (`me`,
 * the day overview) and spies on `invalidateQueries`, so it is part of what the
 * spec is asserting rather than part of the scaffolding.
 */

import type { ComponentProps, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from '@lets-park/i18n';
import cs from '../../messages/cs.json';
import { ApiProvider } from '../shell/api-provider/api-provider';
import { ToastProvider } from '../shell/notifications/toast-provider';

/** The URL the specs use. Never fetched from: every transport is stubbed. */
const API_URL = 'http://localhost:3000/api';

export function createProviderWrapper(
  client: ComponentProps<typeof QueryClientProvider>['client']
): (props: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ApiProvider url={API_URL}>
          <IntlProvider locale="cs" messages={cs}>
            <ToastProvider>{children}</ToastProvider>
          </IntlProvider>
        </ApiProvider>
      </QueryClientProvider>
    );
  };
}
