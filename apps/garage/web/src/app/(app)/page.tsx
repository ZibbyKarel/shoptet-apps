import { LotScreen } from '../../lot/lot-screen/lot-screen';

/**
 * The parking overview — the application's home screen (Task 24).
 *
 * A server component that renders one client component and nothing else. The
 * screen needs the session, the query cache and the socket, all of which live
 * below `app/providers.tsx`'s single `'use client'` boundary; there is nothing
 * left for this file to do on the server.
 */
export default function LotPage() {
  return <LotScreen />;
}
