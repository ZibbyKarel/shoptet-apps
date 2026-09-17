import { redirect } from 'next/navigation';
import { OKTA_PROVIDER_ID } from '@garage/auth';
import { auth, signIn } from '../../auth';
import { LOT_ROUTE } from '../../routes';
import { LoginScreen } from '../../shell/login-screen/login-screen';

/**
 * The one page an unauthenticated visitor may see.
 *
 * It is deliberately outside the `(app)` route group, so it renders without a
 * top bar — the design draws it as a bare white canvas
 * (`doc/design/screens/canvas-default.png`).
 *
 * Auth.js sends people here on its own: `auth.ts` passes this path as
 * `signInPath`, so `pages.signIn` points at it and the proxy's redirect lands
 * here instead of on Auth.js's built-in form.
 */
export default async function LoginPage() {
  // Someone who is already signed in has no business on the sign-in page —
  // they arrive here by bookmark or by pressing Back after signing in.
  // Bouncing them is what stops a second, pointless trip through Okta.
  //
  // The `error === undefined` half of this check matters as much as the
  // `user` half: `libs/garage/auth`'s `isAuthorized` (what `proxy.ts` uses
  // to gate every other route) treats a session with a refresh error as
  // unauthenticated and sends it back here. Without the same check here, a
  // session stuck with `error: 'RefreshAccessTokenError'` bounces forever —
  // rejected by the proxy, then bounced straight back to `/` by this page.
  const session = await auth();
  if (session?.user != null && session.error === undefined) {
    redirect(LOT_ROUTE);
  }

  return <LoginScreen action={signInWithOkta} />;
}

/**
 * Starts the authorization-code flow.
 *
 * A Server Action, so the whole exchange stays on the server: `signIn` issues
 * the redirect to Okta's `/authorize` with PKCE and state, and the code is
 * exchanged in `/api/auth/callback/okta` — the browser never holds the client
 * secret or the refresh token (`doc/decision/0047-*`).
 *
 * `OKTA_PROVIDER_ID` is the constant `libs/garage/auth` registers the provider under,
 * not the literal `'okta'`: it is the same value that fixes the callback URL
 * Okta has to be configured with, and a second spelling of it would break
 * sign-in in a way that only shows up against a real tenant.
 */
async function signInWithOkta(): Promise<void> {
  'use server';
  await signIn(OKTA_PROVIDER_ID, { redirectTo: LOT_ROUTE });
}
