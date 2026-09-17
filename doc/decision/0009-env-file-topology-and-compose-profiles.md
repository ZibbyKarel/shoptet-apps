# 0009 – One `.env.example`, three targets; `web`/`api` in `docker-compose.yml` sit behind a profile

**Date:** 2026-08-28 · **Status:** accepted; point 2 superseded by
`doc/decision/0208-every-service-carries-a-profile-and-the-database-is-a-choice`

> Superseded in part. Point 2 below records that `postgres` and
> `mock-oauth2-server` carry no profile. Both do now: the issuer took `dev` in
> Task 29 so that no production invocation can start it, and `postgres` took
> `dev` and `db` so that a deployment against a managed database does not get an
> unwanted container. Everything in point 1 — the two `.env` copies, and why —
> still holds.

## What

1. There is one `.env.example` at the repo root (exactly as Task 2 requires), but in
   practice **two** `.env` copies must be created from it, not one: `.env` at the
   root (for `docker compose` and for `apps/garage/api` run via `nx serve api`) and
   `apps/garage/web/.env` (for `nx run web:dev` / `next build` / `next start`).
2. The placeholder `web` and `api` services in `docker-compose.yml` have
   `profiles: ['app']`, so `docker compose up` (without `--profile`) doesn't start
   them.

## Why

**1) Two `.env` copies.** `@nestjs/config`'s `ConfigModule.forRoot()` without
`envFilePath` reads `.env` relative to `process.cwd()`. The Nx executor
`@nx/js:node`, which runs `api:serve`, doesn't override the cwd — it stays the repo
root — so the root `.env` is enough for the API. Next.js, however, reads env files
(`.env`, `.env.local`, …) relative to the directory in which the `next` CLI runs, and
`apps/garage/web`'s `dev` target (inferred by the `@nx/next` plugin, see `nx.json`)
explicitly sets `"cwd": "apps/garage/web"`. So Next looks for `apps/garage/web/.env`, not the root
`.env` – verified from the actual behavior of the build/serve targets in
`project.json`, not guessed. A single shared `.env` at the root would simply be
invisible to `apps/garage/web`.

**2) `profiles: ['app']` for `web`/`api`.** The Task 2 brief calls for "placeholder
services, build context ready, but real Dockerfiles only appear in Task 29". Without
Dockerfiles, an unrestricted `docker compose up` would fail
(`dockerfile: apps/garage/api/Dockerfile` doesn't exist). Today's dev workflow also runs
both apps on the host (`nx serve`/`nx dev`), not in a container — at this stage
`docker-compose.yml` only provides infrastructure (`postgres`,
`mock-oauth2-server`, optionally `adminer`). The `app` profile is therefore kept
separate from the `dev` profile (which holds only `adminer`, exactly per the brief)
and from the default, profile-less services (`postgres`, `mock-oauth2-server`) that
every dev wants available at all times.

## How

- `.env.example` (root) opens with a comment explaining exactly this split and
  points to `doc/environment.md`.
- `doc/environment.md`, the "How to start" section, has an explicit `cp .env.example
  .env && cp .env.example apps/garage/web/.env`.
- `docker-compose.yml`: `web`/`api` have `profiles: ['app']` and a comment pointing to
  Task 29; `adminer` keeps `profiles: ['dev']` unchanged; `postgres`/
  `mock-oauth2-server` have no profile.
- Verified: `docker compose config` (no profile) shows only `postgres` +
  `mock-oauth2-server`; `docker compose --profile app config` also shows
  `web`/`api` and validates even with a non-existent Dockerfile (`config` doesn't
  check that the build context/Dockerfile physically exists — that's only checked
  by `docker compose build`, which first runs in Task 29).

## Risk if this is wrong

The split into two `.env` copies is easy to forget, leaving `apps/garage/web` running with
an empty env – but that immediately shows up as a fail-fast crash per
`doc/decision/0008-web-env-validation-instrumentation-hook.md`, not as a silent bug,
so the risk is low. Once Task 29 adds real Dockerfiles and both apps run in
containers in production, this asymmetry disappears on its own (a production
container injects env via `env_file`/the orchestrator, not via a file on disk next
to `next.config.ts`) – at that point it makes sense to remove the `app` profile from
`docker-compose.yml`'s `web`/`api` and let them always run.
