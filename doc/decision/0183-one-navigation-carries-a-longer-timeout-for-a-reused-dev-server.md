# 0183 – One navigation carries a longer timeout, for the run that meets a dev server

## What

`openSettings()` in `apps/garage/web-e2e/src/support/lot-page.ts` waits up to
`FIRST_ROUTE_VISIT_TIMEOUT_MS` (30 s) for `/settings` and for its modal.
Everything else in the suite uses Playwright's 5 s default. The global `expect`
timeout is **not** raised, and no `waitForTimeout` is used anywhere.

## Why

A route that is compiled on demand can take longer than the default to answer.
That is measured, not assumed — from the dev server's own log during a failing
run:

```
GET /settings 200 in 2.1s (compile: 1883ms, proxy.ts: 77ms, render: 135ms)
GET /settings 200 in 4.9s (compile: 1573ms, proxy.ts: 1177ms, render: 2.2s)
```

4.9 s is past the 5 s default before the modal has even started rendering, and
`ics-feed.spec.ts` failed exactly there — `getByLabel('Odkaz na kalendář')`,
element not found — on a machine that was also running three browsers, a webpack
watch, and (as it turned out) twelve orphaned busy-loops from an unrelated
session. It is a **load-bound** failure, which is the class of flake this
project has already had to rewrite two specs for.

Three fixes were considered:

1. **Raise the global `expect` timeout.** Rejected: it makes every genuine
   failure in the suite take six times longer to report, and it hides the
   distinction between "this is slow because it compiles" and "this is broken".
2. **A longer timeout on the one step that pays a compilation.** Chosen. The
   wait is still on a condition — the URL, then the modal being visible — so it
   costs nothing when the route is already warm.
3. **Build the web app and serve it with `next start`.** Rejected here, and
   then **adopted** a few hours later — though the reason recorded at the time
   was wrong. It was adopted because `next dev`'s `StrictMode` was believed to
   be what made `cell-lock.spec.ts` fail one run in four; the actual cause was
   the spec sharing one bay between two concurrent tests against a user-keyed
   `LockService.release` (`doc/decision/0187-*`). Running the built app is still
   right — it is the code production runs, and it removes `StrictMode`'s extra
   connection as a variable — but it did not fix that flake, and the suite's own
   `webServer` now runs `web:start`, so the compilation this record is about
   does not happen on a normal run.

**Which is why the allowance is kept rather than removed.** `reuseExistingServer`
is on outside CI, so a developer with `nx run web:dev` already up still runs the
suite against a dev server, still pays the first-visit compile, and would still
meet the 5 s default with a 4.9 s route. The constant costs nothing on the
default path and is the difference between a green run and a confusing red one
on the other.

The wait is also split in two on purpose: `waitForURL('**/settings')` first,
then the modal. "The menu item did not navigate" and "the modal did not render"
are different bugs, and the failure report should say which one happened.

## How

- `apps/garage/web-e2e/src/support/lot-page.ts` — `FIRST_ROUTE_VISIT_TIMEOUT_MS` and
  `openSettings()`.
- `apps/garage/web-e2e/src/ics-feed.spec.ts` — the only caller.
- `apps/garage/web-e2e/playwright.config.mts` — `retries: 0`. A flake is a bug here; a
  retry would hide exactly the failure this record is about.

## Risk

- **30 s is a guess about the worst case, not a measurement of it.** A cold
  machine compiling for the first time under heavier load could still exceed it.
  The symptom would be an honest, specific failure ("waiting for
  `**/settings`"), not a silent pass.
- **It only covers the route the suite happens to visit second.** A future spec
  that navigates to `/admin` against a reused dev server will meet the same
  first-compile cost and should use the same constant rather than inventing
  another number.
