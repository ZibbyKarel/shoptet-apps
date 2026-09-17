# 0102 – `auth.ts` reads raw `process.env`, so `next build` stays env-free

## What

`apps/garage/web/src/auth.ts` builds the app's Auth.js instance from
`process.env.AUTH_*` directly, with `?? ''` fallbacks, instead of calling
`validateWebEnv()` from `./env.ts`:

```ts
export const { handlers, auth, signIn, signOut, getAccessToken } = createAuth({
  issuer: process.env.AUTH_OKTA_ISSUER ?? '',
  …
});
```

Fail-fast validation of the whole schema still happens — once, at server boot,
in `instrumentation.ts` → `register()`.

## Why

- **`next build` must not require production secrets.**
  `doc/decision/0008-*` verified and recorded that a build passes with no
  environment, because the build does not call the validation. Next.js imports
  route modules while collecting page data, so a module-scope
  `validateWebEnv()` in `auth.ts` — which the Auth.js route handler, the proxy
  and every Server Component reach — would drag the whole schema into the
  build. A CI image that has to be handed `AUTH_OKTA_CLIENT_SECRET` in order to
  compile is a worse arrangement than this one.
- **The validation is not weakened, only relocated to where it already was.**
  `instrumentation-node.ts` calls `process.exit(1)` when `webEnvSchema` fails,
  so no request is ever served by a misconfigured process. The `?? ''`
  fallbacks are unreachable at request time for exactly that reason; they exist
  to satisfy the types during a build that never signs anybody in.
- **The values are still declared in one place.** `webEnvSchema` is the list of
  what this app requires; `auth.ts` hands the four over to `createAuth`
  explicitly. That matters beyond tidiness: Auth.js will otherwise *infer*
  `AUTH_SECRET`, `AUTH_OKTA_ID` and `AUTH_OKTA_SECRET` from the environment on
  its own, and an inferred variable is one the schema never sees.
- **Neither secret is `NEXT_PUBLIC_`**, and this module is imported only from
  server files. The browser half of the wrapper (`@garage/auth/client`)
  reaches the session over `/api/auth/session` and never sees a secret.

## How

Verified both ways rather than argued:

- `nx run web:build` with the environment present → exit 0.
- `nx run web:build` with `.env` and `apps/garage/web/.env` moved aside → exit 0.
  (Both files restored afterwards.)

## Risk

- **A reader may take the `?? ''` as a real default.** The docstring in
  `auth.ts` says at length that it is not, and this record is the second place
  it is written down; there is no third defence. If `instrumentation.ts` ever
  stops exiting on a validation failure, these fallbacks become live and
  Auth.js would start up with an empty secret.
- **The pattern does not generalise.** Anything that is *not* imported during
  page-data collection should keep using `validateWebEnv()`; this exception is
  scoped to the Auth.js instance and its transitive importers.
