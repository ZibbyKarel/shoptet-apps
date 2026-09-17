# 0206 – CI runs the database suites against a real PostgreSQL

## What

`.github/workflows/ci.yml` has three jobs: `verify` (format, lint, typecheck,
test, build), `database` (`nx run api:test-db` against a `postgres:17` service
container) and `images` (both production images build).

## Why

- **Without `database`, a green pipeline would say nothing about the code most
  likely to be wrong.** `apps/garage/api/jest.config.cts` excludes `*.db.spec.ts` from
  `api:test` on purpose — they need a server. That is eight suites and 92 tests
  covering `SELECT … FOR UPDATE`, transaction isolation, and the waitlist
  promotion that shares a cancellation's transaction. A test double cannot
  exercise a row lock, so there is no version of this that runs without a
  database.
- **The job has to be able to fail, and was made to.** Three ways, each
  measured against a container started exactly as the service block specifies:

  | what was broken | exit |
  | --- | --- |
  | nothing (control) | `0`, 8 suites / 92 tests |
  | Postgres unreachable (port 59999) | `1`, `Got error running globalSetup … [AggregateError]` |
  | `DATABASE_URL` absent, no `.env` present | `1`, `DATABASE_URL is not set. … It does not skip itself, on purpose.` |
  | `FOR UPDATE` removed from `WaitlistPromotionService` | `1`, 1 of 92 tests |

  The third row is the one that matters most: a suite that skipped itself
  without a database would turn a missing service into a green build.
- **No migration step in the job.** `apps/garage/api/src/testing/database/global-setup.ts`
  creates a throwaway database per run, applies the committed migrations to it
  and repoints `DATABASE_URL` — and throws when the variable is absent.
- **The service needs a health check.** Without `--health-cmd`, the job would
  reach the tests before Postgres finished `initdb`, and the failure would read
  as a flaky test rather than a race in the workflow file.
- **`nx format:check --all`, not the bare command.** With no base ref to diff
  against — which is what a fresh CI checkout is — plain `nx format:check`
  checks nothing and passes vacuously. `--all` found one genuinely unformatted
  file, `apps/garage/web/.swcrc`, which is reformatted in the same change.
- **`images` guards this task's own output.** A Dockerfile that stops building
  is invisible to every other job, and `.dockerignore` — which is what keeps
  `.env` out of the build context — is only exercised by an actual build.

## How

- `.github/workflows/ci.yml`. `.nvmrc` is the single Node version for CI, both
  Dockerfiles and local development.
- The `database` job's Postgres credentials are literals in the workflow, not
  `secrets.`: they belong to a container created and destroyed inside the job.
  Making them a secret would hide what the job connects to and make it
  unrunnable from a fork.

## Risk

- **GitHub Actions is assumed.** There was no CI configuration in this
  repository at all — no `.github/`, no `.gitlab-ci.yml`, nothing in any
  branch's history — so this is a choice, not a continuation. Every command in
  the file is one a developer runs locally, so porting it is a matter of
  translating job syntax.
- **`api-e2e` and `web-e2e` are not wired in.** They need a served API and, for
  the browser suite, three browsers and the OIDC issuer; that is a longer job
  with its own failure modes and belongs in its own change (`doc/testing.md`).
- **The workflow itself has not been executed by GitHub.** It was verified by
  parsing it and by running each job's steps locally against a service container
  started with the same image, environment and health command.
