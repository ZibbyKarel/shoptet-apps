# api-client

`@garage/api-client` — the wrapper lib that owns `@orpc/client`. It is the only place in
the workspace allowed to import that package.

Usage, the access-token provider and how contract errors are read:
**`doc/wrappers.md`** (section "`libs/shared/api-client` — the oRPC client").

## Running unit tests

Run `nx test api-client` to execute the unit tests via [Jest](https://jestjs.io).
