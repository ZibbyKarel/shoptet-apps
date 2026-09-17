/**
 * Auth.js's own endpoints: `/api/auth/signin`, `/api/auth/callback/okta`,
 * `/api/auth/session`, `/api/auth/signout`.
 *
 * The path is not decorative. `/api/auth/callback/okta` is the redirect URI
 * that has to be registered with the Okta application, and its last segment is
 * `OKTA_PROVIDER_ID` — which is why that is a constant in `libs/garage/auth` and never
 * a literal (`doc/auth.md`, §"What the Okta org has to be configured to do").
 *
 * `src/proxy.ts` deliberately does not match this prefix: a session check in
 * front of the sign-in callback would require being signed in to sign in.
 */
import { handlers } from '../../../../auth';

export const { GET, POST } = handlers;
