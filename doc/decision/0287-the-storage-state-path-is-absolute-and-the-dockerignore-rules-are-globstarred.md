# 0287 – The `storageState` path is absolute, and the `.dockerignore` rules are globstarred

## What

Two changes to one hole:

- `apps/garage/web-e2e/src/support/personas.ts` — `storageStatePath()` returns
  `join(workspaceRoot, 'apps', 'web-e2e', '.auth', …)` instead of the relative
  `apps/garage/web-e2e/.auth/…`.
- `.dockerignore` — the two rules for these files become `**/.auth/` and
  `**/storage-state*.json`.

`doc/decision/0185-*` and `doc/testing.md` are corrected to match.

## Why

Each of those files holds a **live Auth.js session cookie** — carrying the
access *and* refresh token inside its JWE — plus the mock issuer's own session
cookie. Two rules existed to keep them out of a Docker build context. Both
missed the path the files actually occupied.

`storageStatePath()` returned a relative string, and both callers hand it to an
API that resolves against `process.cwd()`: `storageState({ path })` in
`auth.setup.ts` and `browser.newContext({ storageState })` in `fixtures.ts` —
not the config-directory resolution Playwright applies to `use.storageState`.
Nx runs the executor with the cwd set to the *project* root, so the files were
written to `apps/garage/web-e2e/apps/garage/web-e2e/.auth/`. Confirmed on disk. The two sides
agreed with each other, so the suite worked, and the doubled path was recorded
as ugly but harmless.

It was not harmless, because `.dockerignore` patterns are anchored at the
context root. `apps/garage/web-e2e/.auth/` named a directory that did not exist, and
`storage-state*.json` matched only a root-level file. Measured with a real
`docker build` over a synthetic context carrying this repository's
`.dockerignore` and a `RUN find /ctx -type f`:

```
/ctx/.env.example                                              ← correctly re-included
/ctx/apps/garage/web-e2e/apps/garage/web-e2e/.auth/storage-state-user.json   ← NOT excluded
```

`.env`, `apps/garage/web/.env`, a root-level `storage-state-*.json` and
`apps/garage/web-e2e/.auth/…` were all excluded correctly. **Every rule in the file
worked except the two written for the one path that was real.**

`COPY . .` in both `builder` stages would have put that file in a layer.
Multi-stage means it does not reach a runtime image and CI's checkout never has
one — so the exposure is a developer building images on a machine that has run
the suite, and CI's `cache-to: type=gha,mode=max`, which exports the `builder`
layer wholesale.

The documentation made it worse rather than catching it. `0185`'s §How said the
two ignore rules were kept "because a credential leaking into git is not a place
to rely on one rule". In git that reasoning happened to be harmless — patterns
without a slash match at any depth, so `storage-state*.json` was doing all of
the work and the directory rule matched nothing — and in Docker it was the
opposite of true. A defence reasoned, recorded, and never run.

## How

Both halves, because one alone leaves the next refactor to find out again:

- **The path.** `workspaceRoot` from `@nx/devkit` (already imported by
  `global-setup.ts` in the same directory) makes the location every document
  names the location on disk. Nothing else changes: both callers resolve an
  absolute path to itself.
- **The patterns.** `**/`-prefixed, for the same reason `**/.env` is — the
  comment above it in `.dockerignore` records the measured incident where a
  bare `.env` shipped `apps/garage/web/.env` into an image. A pattern that is right
  wherever the file lands survives the next move.

Re-measured with the same `docker build` probe, same context, new
`.dockerignore`:

```
/ctx/.env.example        ← the only file left
```

And after a full suite run with the new `storageStatePath()`: the three files
are at `apps/garage/web-e2e/.auth/`, and `apps/garage/web-e2e/apps/` does not exist.

## Risk

- **`.gitignore` was left alone.** Its two rules now both match, where before
  only the unanchored one did; nothing needs to change for it to be correct.
- **A stale `apps/garage/web-e2e/apps/` directory** may exist in a working tree that
  ran the suite before this change. It is git-ignored, holds expired mock-issuer
  credentials, and can be deleted.
- **`workspaceRoot` walks up from `process.cwd()` for `nx.json`.** Every path
  the suite is invoked by — `nx run web-e2e:e2e`, or `playwright test` from
  `apps/garage/web-e2e` — is inside the workspace, so it resolves. A `playwright test`
  run from outside the repository would now fail loudly instead of silently
  writing credentials to a new relative path, which is the better failure.
