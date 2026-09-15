import type { ReactNode } from 'react';
import { Container } from '@lets-park/design-system/primitives';
import { AppTopBar } from '../../shell/app-top-bar';
import { ToastProvider } from '../../shell/notifications/toast-provider';

/**
 * Everything a signed-in visitor sees sits under the top bar; the login screen
 * does not. That is the whole reason for this route group — it draws the
 * chrome for `(app)/**` without adding a path segment, so the parking overview
 * stays at `/`.
 *
 * There is no session check in *this file*, and there does not need to be:
 * the proxy (`src/proxy.ts`) has already refused the navigation for anyone
 * without a session, and `AppTopBar` — rendered below for all three signed-in
 * routes, unconditionally — calls `useRequireAuth`, which is what catches a
 * session that ends while the tab is open. Repeating the check here would be a
 * third place for the rule to drift.
 *
 * That second half used to be a claim about a hook nothing on `/` mounted.
 * `(app)/layout.spec.tsx` now exercises it: flipping the session to
 * `unauthenticated` under this layout calls `signIn`, and a
 * `RefreshTokenError` calls `signOut`. See `doc/decision/0255-*`.
 */
export default function AppLayout({ children }: { readonly children: ReactNode }) {
  return (
    <ToastProvider>
      <AppTopBar />
      <main>
        <Container>{children}</Container>
      </main>
    </ToastProvider>
  );
}
