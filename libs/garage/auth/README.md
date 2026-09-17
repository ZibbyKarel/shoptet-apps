# auth

`@garage/auth` — the wrapper lib that owns `next-auth` (Auth.js v5). It is the only place
in the workspace allowed to import that package, including `next-auth/react`,
`next-auth/jwt` and `next-auth/providers/okta`.

Two entry points:

- `@garage/auth` — server: `createAuth`, `OKTA_PROVIDER_ID`, and the types `Auth` and
  `AuthOptions`. `createAuth` is the one way in; `createAuthConfig`, the token refresher and
  the access-token seam are its implementation and stay module-scoped.
- `@garage/auth/client` — browser: `AuthProvider`, `useRequireAuth`,
  `useAccessTokenProvider`, plus `useSession`/`signIn`/`signOut`.

Usage, refresh token rotation, and what does and does not reach the browser:
**`doc/wrappers.md`** (section "`libs/garage/auth` — next-auth v5 / Auth.js") and **`doc/auth.md`**
for the flow end to end.

## Running unit tests

Run `nx test auth` to execute the unit tests via [Jest](https://jestjs.io).
