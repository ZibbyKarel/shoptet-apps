# 0028 – `NODE_ENV` must not reach `next build` from `.env` files

**Date:** 2026-08-28 · **Status:** accepted · **Follows on from:** `doc/decision/0009-*`, `doc/decision/0008-*`

## What

The `web:build` target has `options.env.NODE_ENV = "production"` hard-coded in
`apps/garage/web/project.json`. That's the only thing that `build` block in
`project.json` does – everything else (`command`, `cwd`, `cache`, `inputs`,
`outputs`, `dependsOn`) stays inferred by the `@nx/next` plugin, and Nx merges
it with this block.

The general rule that follows from this: **a production build must not
inherit `NODE_ENV` from local `.env` files.** If another build target that
depends on `NODE_ENV` is ever added, the same applies to it.

## Why

The Nx executor `nx:run-commands` loads `.env` from both the workspace root
**and** the project root, and injects them into the spawned process's
environment. Per `doc/decision/0009-*`, a developer has both copies (`.env`
and `apps/garage/web/.env`), and both contain `NODE_ENV=development` – they are dev
env files, that's correct and shouldn't change.

Next.js sets `NODE_ENV=production` during `next build` **only if it isn't
already set**; it respects a value already present in `process.env`. Env files
loaded by Next.js itself (`@next/env`) don't override `NODE_ENV`, so `cd
apps/garage/web && next build` works fine — but `nx run web:build` gets
`NODE_ENV=development` injected from outside beforehand, and Next keeps it.

The result is a build that's half development and half production.
Specifically, React resolution splits: chunks compile against one variant (the
`"production"` export condition), while the prerender worker pulls in React
via the `"development"` condition – producing two React instances, an internal
dispatcher that's `null`, and Next's own `/_global-error` and `/_not-found`
pages failing to prerender with

```
TypeError: Cannot read properties of null (reading 'useContext')
```

A telltale accompanying symptom is dev-only warnings —
`Each child in a list should have a unique "key" prop` on `<html>`/`<head>`/
`<meta>` — showing up in the middle of a production build.

**Why this was hard to find.** The root `.env` is gitignored, so the failure
is a function of local machine state, not of committed code. It first
appeared the moment a developer copied `.env.example` to the root to get
`DATABASE_URL` for Task 9 – i.e. "right around Task 9", even though Task 9
never changed a single line in `apps/garage/web`. A bisect therefore showed nothing,
and couldn't have.

**Why not other fixes.**

- *Remove `NODE_ENV` from `.env.example`* – env files aren't version-controlled
  and must stay purely development-oriented; it also wouldn't fix
  `apps/garage/web/.env`, which a developer creates the same way regardless, and
  `apps/garage/api` relies on `NODE_ENV` being present in the environment
  (`apps/garage/api/src/env.ts`).
- *`NX_LOAD_DOT_ENV_FILES=false`* – a global switch that would also disable
  loading `.env` where it's wanted (`api:serve`, `web:dev`).
- *Disable prerendering / delete the failing pages* – papering over the
  symptom, not a fix.

## How

```jsonc
// apps/garage/web/project.json
"targets": {
  "build": {
    "options": { "env": { "NODE_ENV": "production" } }
  }
}
```

Verification that merging with the inferred target changed nothing else:
`nx show project web --json` must still show `"command": "next build"`,
`"cwd": "apps/garage/web"`, `cache`, `inputs`, `outputs`, and `dependsOn` for `build`.

## Risk if this is wrong

If that line is ever lost (say, during a `project.json` refactor, or a
`@nx/next` upgrade where someone "cleans up" the `build` block as
unnecessary), the build only breaks **on machines that have a root `.env`** –
in CI, where no `.env` exists, it passes. That's the worst possible outcome:
green CI and a broken local build. That's why the rule is written up here, and
not left as just a comment in the JSON (there is one there too, but comments
get deleted more easily than decision records).
