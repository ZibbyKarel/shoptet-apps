# 0008 – Web env-variable validation lives in `instrumentation.ts`, not `next.config.ts`

**Date:** 2026-08-28 · **Status:** accepted

## What

Fail-fast validation of `apps/garage/web`'s env variables (`validateWebEnv`,
`apps/garage/web/src/env.ts`) is not called from the top level of `next.config.ts`, as the
literal wording of Task 2 might suggest ("validation at build/boot time"). It is
called from `apps/garage/web/src/instrumentation.ts` (the Next.js `register()` hook), and
only for the Node.js runtime — via a separate module,
`apps/garage/web/src/instrumentation-node.ts`, not inline. A validation failure also ends
with an explicit `process.exit(1)`, not a plain `throw`.

## Why

**Why not `next.config.ts`.** `next.config.ts` isn't read only by `next
dev`/`build`/`start` – it's also read by the `@nx/next` plugin when computing the Nx
project graph, i.e. by `nx run web:lint`, `web:typecheck`, `nx graph`, etc. Verified
empirically: with `validateWebEnv()` at the top level, `next.config.ts` caused even
`nx run web:typecheck` to fail with no server running at all, because Nx loads
`next.config.ts` without a real `.env`. Validation in the config file would
therefore block commands that have nothing to do with the runtime env.

**Why `instrumentation.ts` → `register()`.** Per the Next.js documentation (verified
via context7, `/vercel/next.js/v16.1.6`), `register()` is called exactly once, when
a new server instance starts (`next dev` / `next start`) – not during `nx`/Nx-plugin
config introspection, and not (empirically verified with a build lacking env) during
`next build`. That matches exactly the requirement "starting the app with a missing
variable results in a crash" — this is about **boot**, not build.

**Why a separate `instrumentation-node.ts`.** `register()` runs in both runtimes
(`nodejs` and `edge`). The validation uses only Node-safe code, but `process.exit()`
doesn't exist in the Edge runtime – Turbopack flagged this during the build as a
warning ("A Node.js API is used … which is not supported in the Edge Runtime"),
even though the run is guarded by the condition `NEXT_RUNTIME !== 'nodejs' →
return`. The runtime condition alone isn't enough, because the bundler analyzes the
code statically for both variants. By moving `process.exit`/`validateWebEnv` into
their own module, referenced only via `await import(...)` inside the condition
(exactly per the pattern in the Next.js documentation for runtime-specific
instrumentation), Turbopack excludes the module from the edge bundle and the warning
goes away.

**Why `process.exit(1)`, not just `throw`.** Verified empirically (`next start`
without env): Next.js catches an error thrown from `register()`, prints "Failed to
prepare server", and **the server keeps running**, answering every request with a
500 — the process does not crash. That violates the fail-fast requirement
("immediate crash"). An explicit `process.exit(1)` after logging the error actually
brings the process down, with the same effect as an exception thrown from
`ConfigModule.forRoot({ validate })` on the API side.

## How

- `apps/garage/web/src/env.ts` – the schema and `validateWebEnv`, with no assumption about
  who calls it.
- `apps/garage/web/src/instrumentation.ts` – `register()`, only routing by `NEXT_RUNTIME`.
- `apps/garage/web/src/instrumentation-node.ts` – the actual validation + `console.error` +
  `process.exit(1)` on failure. `no-console` doesn't apply here (it's enforced only
  in `apps/garage/api/**` and `libs/**`, see `eslint.config.mjs`).
- Verified with a real run: `next build` passes without env (build doesn't call the
  validation); `next start` without env exits (`exit code 1`) with a message naming
  every missing variable, without their values – the output is in
  `task-2-report.md`.

## Risk if this is wrong

If a future Next.js version changes when `register()` is called (e.g. also during
`next build`), the build-time fail-fast guarantee stops holding at all — today it
doesn't hold even in theory, since no hook covers it. Mitigation: `next build` by
itself needs nothing runtime-specific today (no page in Phase 0 reads env variables
from this schema), so the gap has no practical impact right now; once future phases
start reading `NEXT_PUBLIC_*` variables directly in components, a missing/invalid
value won't show up as a build crash, but the build will still fail one step later
(a missing type/value in the component) – and `nx run web-e2e:e2e` would catch such a
configuration mistake at dev-server startup via this same hook.
