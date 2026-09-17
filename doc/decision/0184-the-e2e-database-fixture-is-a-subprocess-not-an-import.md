# 0184 – The e2e database fixture is a subprocess, not an import

## What

`apps/garage/web-e2e`'s `globalSetup` prepares the database by running two commands:

```
npx prisma db seed
node --require @swc-node/register libs/garage/database/src/scripts/reset-e2e.ts
```

It does not `import { PrismaClient }`, and no Playwright worker ever holds a
database connection.

## Why

- **The module boundary forbids the import, and is right to.** `libs/garage/database`
  is tagged `scope:api`; `apps/garage/web-e2e` is `scope:web`, which
  `eslint.config.mjs` restricts to `scope:web` and `scope:shared`. Retagging the
  e2e app, or widening the constraint, would let the whole web scope reach the
  Prisma client so that one test-support file could — the tail wagging the dog.
  A subprocess needs no exemption at all.
- **The scripts already exist and are the documented way to do this.** `prisma
  db seed` is what `doc/database.md` tells a developer to run; `reset-e2e` is a
  sibling of it. The suite doing what a person would do keeps one behaviour, not
  two.
- **No connection pool inside the test runner.** Prisma opens a pool on
  instantiation and Playwright's `globalSetup` shares a process with the
  reporter; a pool left open there is a hang at the end of a run, and a pool
  opened per worker is contention against the API's own.

The date arithmetic in `reset-e2e.ts` is imported from
`@garage/shared-types` — the application's own `addMonths`/`startOfMonth`/
`todayInPrague` — rather than rewritten. That import is why the script needs
`SWC_NODE_PROJECT=tsconfig.base.json`: `@swc-node/register` resolves `paths`
from the tsconfig it is pointed at, and there is no `tsconfig.json` at the
workspace root. Both callers set it.

## How

- `apps/garage/web-e2e/src/support/global-setup.ts` — `execFileSync` for both commands,
  `cwd: workspaceRoot`, `stdio: 'inherit'` so their output lands in the test log.
  It fails fast with a readable message when `DATABASE_URL` is unset, rather
  than letting the first browser meet an empty screen.
- `libs/garage/database/src/scripts/reset-e2e.ts` — the reset itself.
- `libs/garage/database/project.json` — `reset-e2e` target, for running it by hand.

## Risk

- **Two extra process spawns per run**, around a second in total. Immaterial
  next to starting three browsers.
- **`globalSetup` inherits `DATABASE_URL` from Nx's `.env` injection.** Running
  Playwright directly (`npx playwright test`, outside `nx run web-e2e:e2e`) will
  not have it, and the suite says so in its error message rather than failing
  obscurely.
