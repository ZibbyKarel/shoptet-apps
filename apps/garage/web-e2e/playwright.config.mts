import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

/**
 * End-to-end configuration. See `doc/testing.md` for how to run this and what
 * has to be up first.
 *
 * Generated as a .mts file so Node forces ESM regardless of workspace
 * `type`. Playwright routes `.mts` through its ESM loader (dynamic import,
 * bypassing the pirates CJS-compile path), and Nx's native TS strip loads
 * `.mts` directly. Playwright's configLoader auto-discovers
 * `playwright.config.mts` via its extension list
 * (.ts/.js/.mts/.mjs/.cts/.cjs).
 *
 * ## The four things this file settles
 *
 * 1. **Ports.** The web app is on 4200, not 3000. `PORT=3000` in the workspace
 *    `.env` belongs to the API, Nx injects it into every target, and
 *    `apps/garage/web/project.json` pins `next dev --port 4200` because of it. 4200 is
 *    also the origin named by `CORS_ALLOWED_ORIGINS` and by the redirect URI
 *    the app sends to the OIDC issuer, so it is not a free choice.
 * 2. **Both servers.** These specs sign in against a real issuer and read a
 *    real database through the API, so the API has to be up too. Its readiness
 *    probe (`/health/ready`, *outside* the `/api` prefix — `configure-app.ts`
 *    excludes it) checks the database, which makes it the right thing to wait
 *    on: a green probe means Postgres is up as well.
 * 3. **One browser.** The scaffold listed Chromium, Firefox and WebKit. This
 *    suite drives two and three concurrent sessions against one shared
 *    database, so running it three times over would triple the contention for
 *    no coverage: nothing here is browser-specific — no CSS assertions, no
 *    vendor-prefixed API. See `doc/decision/0182-*`.
 * 4. **Whose server the tests are talking to.** The web server is started in a
 *    process group Playwright can actually kill, port 4200 is never reused,
 *    and `src/support/build-identity.setup.ts` refuses to let the suite run
 *    against a build other than the one Nx just produced. Before that, a run
 *    could — and measurably did — report 20 passed against the previous run's
 *    orphaned server. See `doc/decision/0285-*` and the `webServer` entry.
 */
const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4200';

/** Where the API lives. Only its readiness probe is used from here. */
const apiUrl = process.env['E2E_API_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  // Seeds the database and clears the target month. Runs once, before the
  // `setup` project signs anybody in.
  globalSetup: './src/support/global-setup.ts',
  // A failing e2e test in this project is a defect report, not a nuisance to be
  // retried away: a scenario that only passes on the second attempt is hiding
  // something. `forbidOnly` still guards against a committed `test.only`.
  retries: 0,
  forbidOnly: !!process.env['CI'],
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Every spec drives Czech UI copy; the browser should ask for it too.
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
  },
  webServer: [
    {
      // **This entry almost never starts anything, and that is not a mistake.**
      // `@nx/playwright` reads these commands when it infers the `e2e` target
      // and turns any that names an Nx target into a real task dependency: `nx
      // show project web-e2e --json` shows `dependsOn: [{projects: ['api'],
      // target: 'serve'}]`, which exists only because of the string below. So
      // Nx starts the API first, with Nx's environment, and Playwright finds
      // port 3000 already answering and adopts it.
      //
      // The entry is kept because it is what *declares* that dependency, and
      // because it still starts an API when something runs `playwright test`
      // directly. But nothing set here reaches an Nx-started process. An `env`
      // block raising `THROTTLE_LIMIT` used to sit here and never applied —
      // measured, `X-RateLimit-Limit: 300` and strict `20`, the shipped
      // defaults — so it was removed rather than left looking effective.
      // `doc/decision/0186-*` records what actually keeps the suite under the
      // limit and what to do on the day it does not.
      command: 'npx nx run api:serve',
      url: `${apiUrl}/health/ready`,
      // Unconditionally `true`, unlike the web server below: Nx's `dependsOn`
      // has already started this one whether or not `CI` is set, so refusing to
      // reuse it under CI would only make Playwright try to bind an occupied
      // port and fail.
      reuseExistingServer: true,
      cwd: workspaceRoot,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The **built** app, not `next dev`, on the port the OIDC redirect URI
      // and `CORS_ALLOWED_ORIGINS` name.
      //
      // The reason is not speed. `next dev` runs React under `StrictMode`,
      // which mounts every effect twice, so a dev server gives every page a
      // second socket.io connection as a matter of course. A page with two
      // connections sits in the day room twice and hears its own `cell:locked`,
      // which the gateway broadcasts to everybody *except* the asking socket.
      // `doc/decision/0187-*` has the packet traces and the measured rates.
      //
      // The built app does *not* have a second way of doing this, though that
      // was believed and recorded for a while: measured per document rather
      // than per page, it is one connection, 89 documents out of 89
      // (`doc/decision/0221-*`, `src/realtime-connection.spec.ts`).
      //
      // **`next start` directly, not `npx nx run web:start`, and that is the
      // whole point of this line.** Nx's `run-commands` executor spawns its
      // task with `detached: process.platform !== 'win32'` — a *new process
      // group* — and its own source says why that is safe for Nx: "detached
      // children don't get OS SIGINT (own process group via setsid); the
      // orchestrator's cleanup() sends SIGTERM via killProcessTreeGraceful."
      // That orchestrator only runs when Nx is asked to stop. Playwright does
      // not ask: it SIGKILLs *its* process group (`process.kill(-pid)`), which
      // reaches the shell and `nx`, and nothing at all in the group Nx made.
      // The `next start` behind it was left running, reparented to PID 1, on
      // every run — measured: 20 passed, exit 0, and `next-server` still
      // holding 4200 with PPID 1 afterwards. `doc/decision/0285-*`.
      //
      // Running `next start` under Playwright's own shell puts the server in
      // the group Playwright kills, so the port is free when the run ends.
      // The build that used to come from `web:start`'s `dependsOn: ['build']`
      // is now a real Nx dependency in `apps/garage/web-e2e/project.json` — it never
      // came from this string, which `@nx/playwright` cannot parse into a
      // target because of the `-- --port` it used to carry.
      command: 'npx next start --port 4200',
      // `web:build` and `web:start` both pin this, because Nx injects the
      // workspace `.env` (NODE_ENV=development) into every target and serving
      // a production build under it is the mixed React resolution
      // `doc/decision/0028-*` is about. Playwright merges this over
      // `process.env`, so the pin survives the move off `web:start`.
      env: { NODE_ENV: 'production' },
      url: `${baseURL}/api/health`,
      // **Never reuse.** This was `!process.env['CI']`, which is `true` on
      // every path that exists, and it is what turned the leaked server above
      // into a silent false green: a second run adopted the first run's
      // process, served the first run's build, and reported 20 passed without
      // executing `web:build` at all. `false` makes an occupied 4200 a loud
      // "is already used" failure instead of a green run against the wrong
      // server. `src/support/build-identity.setup.ts` is the second half:
      // it fails the run when the app answering here is not the build this
      // workspace just produced, whatever started it.
      reuseExistingServer: false,
      cwd: join(workspaceRoot, 'apps', 'garage', 'web'),
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'setup',
      // Every `*.setup.ts` under `support/`, not just `auth.setup.ts`:
      // `build-identity.setup.ts` has to run before the specs it protects, and
      // `chromium` already declares `dependencies: ['setup']`, so listing the
      // directory rather than one file is what makes a new guard take effect.
      testMatch: /support\/[^/]+\.setup\.ts$/u,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: /support\//u,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
