# 0006 – Nx layout: `project.json` + path aliases in `tsconfig.base.json`

**Date:** 2026-08-28 · **Status:** accepted

## What

The workspace uses the **classic Nx layout**, not the newer "TS solution setup":

- every project has its own `project.json` (`--useProjectJson`),
- libs are resolved via path aliases in `tsconfig.base.json`
  (`"@garage/contract": ["./libs/garage/contract/src/index.ts"]`),
- **not** npm workspaces + TypeScript project references (`--no-workspaces`).

## Why

`create-nx-workspace` today defaults to offering the TS solution setup (npm
workspaces, `references`, `nx sync`). For this project the classic layout is
preferable:

- **No `nx sync`.** In the TS solution setup, adding a dependency between libs
  requires regenerating `references`; in a non-interactive run (CI, subagent) the
  task fails with a prompt to "run nx sync" instead of running. The project spans 29
  tasks that progressively add 13 libs – this paper cut would repeat over and over.
- **One greppable list.** All entry points live in one place, in
  `tsconfig.base.json`, which matches decision 0005 (scope `@lets-park`) and makes
  it easy to check that no lib is created outside the scope.
- **Source instead of build.** Libs resolve to `src/index.ts`, so `lint`, `test` and
  `typecheck` don't need libs built first. Faster, and fewer states in which a run
  can fail.

Subpath entry points (`@garage/contract/realtime` per `plan.md`) work under
either variant – in the classic layout, as a second entry in `paths`.

## How

- Workspace generated via `create-nx-workspace@23.1.2 --preset=apps
  --workspaceType=integrated --no-workspaces --useProjectJson --pm=npm --nxCloud=skip`.
- Scope `@lets-park` follows from the root `package.json` name (`@lets-park/source`);
  Nx generators derive the alias from it automatically – verified by generating and
  deleting a test lib.
- New libs are added via a generator that fills in the alias in
  `tsconfig.base.json` itself (see `doc/workspace.md`).

## Risk if this is wrong

Nx supports both layouts and offers a migration to the TS solution setup; the
switch is, however, a sweeping change across every `tsconfig.json` and
`package.json` in the repo. If it turns out the project needs buildable,
publishable packages (which the MVP doesn't – a single instance is deployed), that's
one dedicated task's worth of work, not a decision that would block anything sooner.
