# 0285 – The browser suite starts a server it can kill, and refuses to adopt one

## What

`apps/garage/web-e2e/playwright.config.mts`'s web `webServer` entry changed in three
ways, and `apps/garage/web-e2e/project.json` in one:

- The command is `npx next start --port 4200` with `cwd` set to `apps/garage/web`,
  not `npx nx run web:start -- --port 4200`.
- `reuseExistingServer` is `false`, not `!process.env['CI']`.
- `NODE_ENV: production` is pinned on the entry, which is what `web:start`'s
  target options used to supply.
- `web-e2e:e2e` now declares `dependsOn: [api:serve, web:build]` explicitly.
  The build used to happen only as a side effect of Playwright spawning
  `web:start`.

A new spec, `src/support/build-identity.setup.ts`, runs in the `setup` project
and fails the run when the app answering on the base URL is not the build in
this working tree.

## Why

The suite left its own server running, and adopted it on the next run.
Measured, twice, before any change:

```
run 1: npx nx run web-e2e:e2e  → exit 0, "20 passed (12.9s)"
       lsof -nP -iTCP:4200 -sTCP:LISTEN  → node 1305
       ps -o pid,ppid -p 1305            → 1305  1     ← reparented, orphaned

run 2: npx nx run web-e2e:e2e  → exit 0, "20 passed (8.6s)"
       lsof                              → the same PID 1305, ELAPSED 01:10
```

Run 2 started nothing. It adopted run 1's process, serving run 1's build, and
`web:start` — with the `dependsOn: ['build']` that was the only thing building
the app — did not execute at all. **A source change made between the two runs
was invisible to the second.** That is a deliberately broken build testing
green, reached without breaking anything, and nothing in the output says so.

### Why the server survived

Nx's `run-commands` executor spawns its task with
`detached: process.platform !== 'win32'` — a new process group
(`node_modules/nx/dist/src/executors/run-commands/running-tasks.js:270`). Nx's
own comment a few lines below says why that is safe *for Nx*:

> In the direct path, detached children don't get OS SIGINT (own process group
> via setsid); the orchestrator's cleanup() sends SIGTERM via
> killProcessTreeGraceful.

That orchestrator runs when Nx is asked to stop. Playwright does not ask it: it
SIGKILLs **its own** process group, `process.kill(-pid)`. The signal reached the
shell and `nx`, and nothing in the group Nx had made. A SIGKILL cannot be
handled, so Nx never got the chance to clean up, and `next start` was reparented
to PID 1 still holding 4200.

Running `next start` under Playwright's shell puts the server in the group
Playwright kills. Measured after the change: two consecutive runs, **21 passed**
each, `lsof` on 4200 empty after both, and each run's log carrying its own
`[WebServer] ✓ Ready in …`.

### Why the guard was dead

`reuseExistingServer: !process.env['CI']` was the only defence, and `CI` was
never set for this suite, because CI ran no e2e job (`doc/decision/0286-*`).
The expression evaluated to `true` on every path that existed. It is now
unconditionally `false`, so an occupied 4200 stops the run:

```
Error: http://localhost:4200/api/health is already used, make sure that nothing
is running on the port/url or set reuseExistingServer:true in config.webServer.
```

The API's entry keeps `reuseExistingServer: true` and that is still right: Nx's
`dependsOn` has already started it, and refusing to reuse it would make
Playwright try to bind an occupied 3000.

## How the identity check works, and what it took to trust it

`next build` writes a fresh random id to `apps/garage/web/.next/BUILD_ID`, and a
server stamps the id it holds into the flight payload of every document, as
`"b":"<id>"`. The check compares that against the file `web:build` just wrote.

**When the server latches that id was measured, and the first two answers were
both wrong.** One server, one workspace, ids A → B → C:

| Step | Result |
| --- | --- |
| Server started on build A; `.next/BUILD_ID` overwritten by hand under it | Served id unchanged — so it is not re-read per request |
| Server started on A, **first request made only after** a rebuild to B | Served **B** — so it is not read at boot either |
| Same server, rebuild to C which also changed a string on the sign-in page | Served **B**, and B's markup: the changed string was absent. A fresh server on the same `.next` served C and the new string |

So the id is read on the first render a process serves and cached from then on.
A server that has answered anything — and an adopted one spent the previous run
answering that run's tests — is pinned to the build that was on disk then, and
serves that build's compiled code. The third row is what makes "stale id" and
"stale code" the same fact rather than two hopeful ones.

A check for this was written and nearly shipped on the strength of the first
row alone, which would have made it a comment with an `expect()` around it.

## Risk

- **An occupied 4200 is now a failure rather than a slow success.** That is the
  point, and `README.md`, `CLAUDE.md` and `doc/testing.md` all say to free the
  port first. A developer running `nx run web:dev` alongside the suite will now
  be told.
- **The web server no longer inherits Nx's environment**, since Nx no longer
  starts it. In practice `next start` loads `apps/garage/web/.env` itself and
  Playwright merges `process.env` under the entry's `env`, and the whole suite
  was re-run with **both `.env` files removed** and only the CI job's
  environment set: 21 passed, exit 0.
- **`@nx/playwright` no longer infers the web build from the command string.**
  It never did — `nx show project web-e2e --json` listed only `api:serve`,
  because `-- --port 4200` is not a string it can parse. That is now spelled in
  `project.json` instead of being believed.
- `doc/decision/0183-*`, `0186-*` and `0187-*` each describe
  `reuseExistingServer` as on outside CI. That was true when they were written;
  this record supersedes that half of them.
