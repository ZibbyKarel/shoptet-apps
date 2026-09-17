# 0203 – The API's runtime modules are installed with `npm install`, not `npm ci`

## What

`apps/garage/api/Dockerfile`'s `runtime-deps` stage runs

```
npm install --omit=dev --ignore-scripts --no-audit --no-fund
```

against the `package.json` webpack generates into `dist/apps/garage/api`, and ignores
the `package-lock.json` generated beside it.

## Why

- **The generated lockfile does not agree with the generated manifest.**
  `npm ci` against the pair fails:

  ```
  npm error `npm ci` can only install packages when your package.json and
  npm error package-lock.json … are in sync.
  npm error Missing: content-type@1.0.5 from lock file
  ```

  The pruner keeps `node_modules/content-type@1.0.5` and, separately, an
  `@nestjs/platform-express/node_modules/content-type@2.1.0`; express 5 nested
  under `platform-express` needs `^1.0.5` and npm's reifier will not accept the
  hoisted copy through the shadowing one. Reproduced outside Docker, in a bare
  directory holding only those two files.
- **Nx's own targets for this cannot run here.** `api:prune` /
  `api:prune-lockfile` exist in `apps/garage/api/project.json`, and both fail with
  `apps/garage/api/package.json does not exist` — `@nx/js:prune-lockfile` expects a
  per-project manifest, and this workspace is `project.json`-only
  (`doc/decision/0006-*`).
- **The alternative is fully locked and five times the size.** `npm ci
  --omit=dev` against the *workspace* lockfile works and is reproducible, but
  installs the web app's tree into the API image as well. Measured, both on this
  machine: 766 MB / 447 packages against 137 MB / 195 packages.
- **The reproducibility actually lost is bounded.** All 29 direct dependencies
  are exact-pinned by the generated manifest (`"@nestjs/common": "11.2.3"`, no
  ranges anywhere); only transitive versions are resolved at build time.

The web image has no equivalent problem: `next build --output standalone` copies
the modules it traced from the workspace install, which came from the workspace
lockfile.

## How

- `apps/garage/api/Dockerfile`, stage `runtime-deps`. `--ignore-scripts` because
  nothing in this set needs to run code at install time and an image build is
  the last place it should be able to.
- The `prune`, `prune-lockfile` and `copy-workspace-modules` targets in
  `apps/garage/api/project.json` are left as they are: they are unused, and fixing
  scaffolding this Dockerfile does not call for is not this change's business.

## Risk

- **A transitive dependency can move between two builds of the same commit.**
  The mitigation, if this ever matters, is a registry that pins by policy or a
  lockfile committed for `dist/apps/garage/api` — not a hand-edited copy of a broken
  one.
- **If Nx ever fixes the pruner**, this stage should go back to `npm ci`. The
  reproduction above is what to re-run to find out.
