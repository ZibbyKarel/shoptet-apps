# 0286 – CI runs the e2e suites, because nothing else does

## What

`.github/workflows/ci.yml` gains a fourth job, `e2e`, which runs
`api-e2e:e2e` and `web-e2e:e2e` against a `postgres:17` service and a
`ghcr.io/navikt/mock-oauth2-server` container. No `continue-on-error`: a red
journey is a red build.

`verify` also gains `build-storybook`, which it had been leaving out.

## Why

The workflow had three jobs — `verify`, `database`, `images` — and `verify` ran
`-t lint,typecheck,test,build`. `e2e` was in no list and no other job invoked
it. So the 8 tests in `apps/garage/api-e2e` and the 20 in `apps/garage/web-e2e` ran only when
a developer remembered.

That is not a general coverage complaint. Those journeys are the **only** place
several things are exercised end to end at all:

- sign-in through a real OIDC authorization-code redirect — PKCE, `state`, the
  issuer's form, the callback, the code exchange;
- sign-out durability, including the kept-cookie-is-refused case
  (`doc/decision/0230-*`);
- the cell-lock broadcast between two live browser sessions;
- waitlist promotion observed through the UI rather than through a service call;
- the ICS feed's token-only-credential model;
- and, in `api-e2e`, the API spoken to over HTTP with a real bearer token.

It also had a second-order effect that was worse than the gap itself:
`reuseExistingServer: !process.env['CI']` in `playwright.config.mts` was the
only guard against the browser suite adopting a stale server, and because
nothing ever set `CI` for that suite the expression was `true` on every path
that existed. A dead job made a live guard dead too — see
`doc/decision/0285-*`, which is the other half of this.

The file's own header claimed three jobs "each gating something the others
structurally cannot see". True of the three that were there, silent about the
layer that was not. That sentence is why the header now names four and says
what the fourth is for.

`build-storybook` is the same class of omission at a smaller scale: `npm run
build` — what a developer runs — is `-t build,build-storybook`, `plan.md` makes
a story mandatory for every primitive and every compound, and CI built only
`build`. A broken story reached `main` and the local script was the first thing
to notice.

## How

The job mirrors the `database` job's shape, plus what a browser needs:

- **`postgres:17`** with the same health check and the same throwaway
  credentials in plain text. They are not secrets and must not become
  `secrets.` references — that would make the job unrunnable from a fork and
  hide what it connects to.
- **`mock-oauth2-server`**, no `JSON_CONFIG`, exactly as
  `docker compose --profile dev` starts it: `personas.ts` supplies `email` and
  `name` through the sign-in form's optional-claims field
  (`doc/decision/0180-*`). It publishes every URL it mints from the Host header
  of the request it answers (`doc/decision/0201-*`); here the browser, the API
  and the web app all reach it as `localhost:8080`, so there is one name.
  The image ships no health check, so a step waits on its discovery document,
  which is a stronger statement than a TCP connect.
- **`npx playwright install --with-deps chromium`** — one browser, matching
  `doc/decision/0182-*`.
- **`prisma migrate deploy` then `prisma db seed`.** Unlike `database`, nothing
  here builds its own schema: `api-e2e` talks to a booted API and `web-e2e`
  drives a browser, so both need the real database migrated and seeded. The
  seed is what makes `dev-admin` an admin — the role is a column, and no token
  can grant it.
- The two targets in separate steps and in that order, because `api-e2e`'s
  teardown kills whatever holds port 3000 and `web-e2e` then has Nx start its
  own API.
- The Playwright report is uploaded `if: failure()` only; it is the only way to
  read a browser failure that did not happen on your machine.

The environment block is `.env.example`'s values, which is what a developer
runs against, with `LOG_LEVEL: warn` instead of `info` because the API logs one
line per request and the browser suite makes several hundred.

## How it was checked without a runner

A workflow cannot be exercised from a laptop, so the part that *can* be wrong
was exercised instead: whether the environment block alone is enough, with no
`.env` file anywhere. Both `.env` and `apps/garage/web/.env` were moved out of the
worktree and the three commands run from a stripped environment
(`env -i`) carrying only the job's variables:

```
npx prisma migrate deploy   → exit 0
npx prisma db seed          → exit 0
npx nx run api-e2e:e2e      → exit 0, 2 suites / 8 tests
npx nx run web-e2e:e2e      → exit 0, 21 passed
```

Both `.env` files were then restored. What that does **not** prove is anything
about the Ubuntu runner image, the service-container networking, or
`playwright install --with-deps`; the first real run of this job is its first
real measurement, and that is stated here rather than glossed.

The run also caught a genuine defect in an unrelated edit of the same round —
a `**/` inside a block comment in `personas.ts` closing the comment early —
which is the sort of thing a job that never runs never finds.

## Risk

- **CI gets slower.** The job installs a browser and runs two suites; it runs in
  parallel with the other three, so wall-clock cost is its own duration, not an
  addition to `verify`.
- **A flaky browser test now blocks merges.** `retries` is `0` on purpose
  (`doc/decision/0182-*`): a scenario that only passes on the second attempt is
  a defect report. If this job starts flaking, the answer is the test, not a
  retry count.
- **`CI` is now genuinely set for the browser suite** for the first time. That
  turns on `forbidOnly`, and it changes what `!process.env['CI']` evaluates to
  in any config comment still assuming otherwise — `playwright.config.mts` no
  longer has one.
