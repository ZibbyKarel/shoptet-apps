/**
 * `@garage/auth` — the wrapper lib that owns `next-auth` (Auth.js v5).
 *
 * This is the **server** entry point. Browser components import
 * `@garage/auth/client` instead — see `libs/garage/auth/src/lib/client.tsx` for
 * why the two are kept apart.
 *
 * There is one way in, and it is `createAuth`: one call in `apps/garage/web` produces
 * the route handlers, the universal `auth()`, server-side `signIn`/`signOut`,
 * and a `getAccessToken` ready to hand to `createApiClient`. `OKTA_PROVIDER_ID`
 * is here beside it because the sign-in page names the provider it dials.
 *
 * **Everything else this lib is assembled from stays module-scoped on
 * purpose.** `createAuthConfig`, the three callbacks it hangs off, the token
 * refresher, the access-token seam and the sign-out revocation registry are
 * `createAuth`'s implementation, not a second supported way to build an
 * Auth.js instance; publishing them made it impossible to tell from the
 * interface which of twenty-eight symbols was the entry point. The lib's own
 * specs reach them through `./lib/config`, `./lib/refresh`, `./lib/revocation`
 * and `./lib/access-token` — the internal seam `config.spec.ts` and
 * `refresh.spec.ts` were already using for `sharedRevokedStore` and
 * `sharedRefreshStates`, which were withheld from here for the same reason.
 *
 * See `doc/wrappers.md` for why the direct `next-auth` import is banned
 * everywhere else, and `doc/auth.md` for the flow end to end.
 */

export { createAuth } from './lib/create-auth';
export type { Auth } from './lib/create-auth';
export type { AuthOptions } from './lib/config';

export { OKTA_PROVIDER_ID } from './lib/session';
