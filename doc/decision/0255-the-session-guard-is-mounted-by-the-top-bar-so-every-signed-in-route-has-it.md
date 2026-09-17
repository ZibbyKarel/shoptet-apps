# 0255 – The session guard is mounted by the top bar, so every signed-in route has it

## What

`AppTopBar` (`apps/garage/web/src/shell/app-top-bar.tsx`) calls `useRequireAuth()`
instead of `useSession()`. `apps/garage/web/src/app/(app)/layout.tsx` renders it
unconditionally for all three signed-in routes, so `/`, `/settings` and
`/admin` all carry the guard. The layout's header comment, which claimed this
was already true, now says where it is true and points at the test.

## Why

- **The claim was false, and the consequence was a dead end rather than a
  missing redirect.** `useRequireAuth` was imported by `shell/settings-page.tsx`
  and the four admin panels only — never by `/`, the screen the product exists
  for and the one a tab is left open on. When a session ends in another tab,
  Auth.js broadcasts it and `useSession().status` flips to `'unauthenticated'`.
  `lot-screen.tsx` and `shell/use-current-user.ts` both gate their query on
  `status === 'authenticated'`, and a disabled TanStack query stays
  `status: 'pending'` for ever — so the screen rendered `<ScreenLoading />`
  ("Načítá se…") indefinitely, with no redirect, no `signIn()` and no message.
  The only recovery was a manual reload.
- **The refresh-failure path was worse, because it looks like it is working.**
  When the Okta refresh fails, `status` stays `'authenticated'` while
  `accessTokenOf` withholds the token, so every oRPC call answers 401 (not
  retried — `shouldRetryQuery`) and the socket handshake is refused. The user
  got a generic error with a retry button that could never succeed, and
  `signOut()` — which exists precisely to clear the dead cookie before anything
  else is attempted with it — was never called.
- **`/admin` was only nominally covered.** `AdminScreen` early-returns
  `<ScreenLoading />` while `useCurrentUser()` is pending
  (`shell/admin-screen/admin-screen.tsx`), so the panels that *did* call `useRequireAuth`
  were never mounted in exactly the states where it was needed. Putting the
  guard above the tabs fixes that without touching `AdminScreen`.
- **The top bar rather than the layout.** `(app)/layout.tsx` has no
  `'use client'` directive and no other reason to become a client component;
  `AppTopBar` is already one, is already rendered by that layout for every
  signed-in route, and already reads the session. One call replaces the read it
  was doing, so there is no second `useSession` subscription and no way for a
  caller to take the read without the guard.
- **The proxy is the other half and does not overlap.** `src/proxy.ts` refuses
  the *navigation* for a visitor with no session. It cannot see a session that
  ends after the page is already open, which is the entire case this handles.

## How

- `apps/garage/web/src/shell/app-top-bar.tsx` — `useRequireAuth()` in place of
  `useSession()`; the hook returns the same session, so the rest of the file is
  unchanged.
- `apps/garage/web/src/app/(app)/layout.tsx` — the header states where the guard is
  and names the test that holds it.
- `apps/garage/web/src/app/(app)/layout.spec.tsx` — new. Renders the real `AppLayout`,
  which renders the real `AppTopBar`, which calls the real `useRequireAuth`.
  The only double is `next-auth/react` itself, i.e. the third party *underneath*
  the wrapper, so every line of the guard under test is the shipped one.
  Flipping the mocked session to `unauthenticated` while the layout is mounted
  calls `signIn('okta')`; setting `error: 'RefreshTokenError'` calls `signOut()`
  and not `signIn`; `loading` does neither; and the redirect fires once, not
  once per render.
- `apps/garage/web/src/lot/lot-screen/lot-screen.spec.tsx` — the test *"does not fetch the day
  before the session exists"* also asserted `getByRole('status')` reads
  "Načítá se…" for an `unauthenticated` session, i.e. it pinned the broken
  behaviour as correct. The gate assertion stays; the spinner assertion is
  replaced by a comment explaining why it is not this screen's outcome.

## Risk

- **The guard now runs on every signed-in screen, including during a slow
  session fetch.** `useRequireAuth` returns early while `status === 'loading'`,
  so a visitor whose `/api/auth/session` is slow is not bounced; that is
  asserted.
- **Mocking `next-auth/react` in `apps/garage/web` is a reach past the wrapper, in a
  spec only.** The alternative was mocking `@garage/auth/client`, which would
  have reduced the test to asserting that a mock was called — the exact defect
  class this review round exists to remove. `no-restricted-imports` is
  unaffected: `jest.mock` takes a string, not an import.
