# Environment – env variables, Docker stack, fail-fast validation

This document describes **what env variables the applications need**, **how to
start the local Docker stack**, and **how dev/e2e differ from production**
(only in variable values, never in code). The source of truth for the shape
of the variables is the Zod schema in `apps/garage/api/src/env.ts` and
`apps/garage/web/src/env.ts` – this document is descriptive, not authoritative; when
they disagree, trust the code.

---

## Philosophy: fail-fast, no test-only branches

Both applications validate their env variables right at startup via a Zod
schema. If a variable is missing or has the wrong shape, the application
**crashes immediately** with a readable message naming the variable (never its
value):

- **`apps/garage/api`** – validation runs inside
  `ConfigModule.forRoot({ validate: validateApiEnv })`
  (`apps/garage/api/src/app/app.module.ts`). A validation failure throws before
  `app.listen()`, so the process never starts accepting requests with an
  invalid configuration.
- **`apps/garage/web`** – validation runs in `apps/garage/web/src/instrumentation.ts` →
  `register()`, which Next.js calls exactly once at server startup (`next
  dev` / `next start`). Next.js itself doesn't terminate the process on an
  error from there (it would keep running and returning 500s), so
  `apps/garage/web/src/instrumentation-node.ts` calls `process.exit(1)` after logging
  the error – making the process just as "dead" as the API's. Details, and
  why this isn't in `next.config.ts`, are in
  `doc/decision/0008-web-env-validation-instrumentation-hook.md`.

**Dev, e2e, and production all run exactly the same code.** Only the variable
values differ – in dev/e2e, `AUTH_OKTA_ISSUER` points at a
`mock-oauth2-server` running in Docker; in production, at the real Okta
issuer. Nowhere in the code is there an `if (isTest)` or any other test-only
shortcut for auth.

---

## Env variables

### `apps/garage/api` (`apps/garage/api/src/env.ts`)

| variable | shape | what it's for |
| --- | --- | --- |
| `NODE_ENV` | `development` \| `test` \| `production` | the standard Node environment switch |
| `PORT` | integer 1–65535 | the port the NestJS HTTP server listens on |
| `DATABASE_URL` | absolute URL | the Postgres connection string (`postgresql://user:pass@host:port/db`) |
| `AUTH_OKTA_ISSUER` | absolute URL | the OIDC issuer whose JWKS is used to validate incoming JWTs. The JWKS URL itself is **discovered** from `${AUTH_OKTA_ISSUER}/.well-known/openid-configuration`, never hardcoded – see `doc/auth.md` |
| `AUTH_OKTA_AUDIENCE` | non-empty string | the expected `aud` claim in a JWT |
| `CORS_ALLOWED_ORIGINS` | comma-separated list of absolute URLs | the CORS allow-list; no wildcard |
| `LOG_LEVEL` | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace` | the log level for `nestjs-pino` |

The schema is written so that later phases can **only add** keys (Slack, ICS) –
no existing key may be loosened.

#### Operational baseline – keys with a default

These variables are **not required**; when absent, the default from the table is
used. They all belong to the operational baseline described in
`doc/api-operations.md`.

| variable | shape | default | what it's for |
| --- | --- | --- | --- |
| `THROTTLE_TTL_MS` | positive integer (ms) | `60000` | the global rate-limit window |
| `THROTTLE_LIMIT` | positive integer | `300` | requests per window, per route |
| `THROTTLE_STRICT_TTL_MS` | positive integer (ms) | `60000` | the window for the stricter tier (`StrictThrottle()`) |
| `THROTTLE_STRICT_LIMIT` | positive integer | `20` | requests per window for the stricter tier |
| `BODY_LIMIT` | a size **with a unit**, e.g. `100kb` | `100kb` | the maximum request body size |
| `HEALTH_DB_TIMEOUT_MS` | positive integer (ms) | `3000` | how long `/health/ready` waits for `SELECT 1` |
| `REALTIME_LOCK_TTL_MS` | positive integer (ms) | `30000` | how long a cell's editing hold lasts before it lapses – see `doc/realtime.md` and `doc/decision/0110-*` before changing it, because `libs/garage/realtime-client`'s renewal budget is sized against it |

Two things that are easy to miss:

- `BODY_LIMIT` **must carry a unit.** The schema rejects a bare `100`, because to
  the Express body parser that means *one hundred bytes* – which is almost never
  what someone meant to write.
- Times are in **milliseconds** (hence the `_MS` suffix). `@nestjs/throttler` v5
  took seconds and v6 takes milliseconds; the suffix is there so the two cannot
  be confused when reading a `.env`.

**Why these have defaults instead of being required.** `.env.example` belongs to
another task's file set, so a required key would have broken every existing
`.env` with no way to update the example alongside it. The defaults in
`apps/garage/api/src/env.ts` (`ENV_DEFAULTS`) are also the production values, so leaving
these keys out of a `.env` entirely is legitimate.

#### Slack and scheduled jobs (Task 16)

Also all optional, for the same reason. Full behaviour is in `doc/slack.md`.

| variable | shape | default | what it's for |
| --- | --- | --- | --- |
| `SLACK_ENABLED` | exactly `true` or `false` | `false` | whether outbound Slack calls actually leave the process |
| `SLACK_BOT_TOKEN` | non-empty string | – | the bot token (`xoxb-…`). **Required when `SLACK_ENABLED=true`** |
| `SLACK_CHANNEL_ID` | non-empty string | – | channel for the freed-spot notice and the daily summary. **Required when `SLACK_ENABLED=true`** |
| `SLACK_REQUEST_TIMEOUT_MS` | positive integer (ms) | `5000` | per-attempt HTTP timeout for a Slack call |
| `SLACK_RETRY_ATTEMPTS` | positive integer | `3` | total attempts, the first included; `1` disables retrying |
| `SLACK_RETRY_BASE_DELAY_MS` | positive integer (ms) | `500` | first backoff delay; doubles per further attempt |
| `SLACK_DAILY_SUMMARY_AT` | `HH:MM`, 24-hour | `08:00` | when the daily summary is posted, **in Europe/Prague** |

Four things that are easy to miss:

- **`SLACK_ENABLED` is not coerced.** Only the two literals parse. `z.coerce.boolean()`
  would read `false`, `0` and `no` as *true*, which is the wrong direction for a
  switch whose off position is what keeps a laptop from posting into a real
  workspace.
- **`SLACK_ENABLED=true` without a token or channel refuses to boot**, naming the
  missing variable and never its value — the same fail-fast contract as every
  other key here.
- **`SLACK_DAILY_SUMMARY_AT` carries no `_MS` suffix on purpose.** It is a time of
  day, not a duration: 08:00 Prague is a different number of milliseconds from
  midnight on the two days a year the offset changes, which is exactly why the
  cron is registered with `timeZone: 'Europe/Prague'` rather than as an interval.
- **The daily job runs every day** and skips weekends and Czech public holidays
  itself, using the same `isBusinessDay` the reservation rules use. A
  weekday-only cron expression would have covered Saturday and Sunday but not
  28 September.

### `apps/garage/web` (`apps/garage/web/src/env.ts`)

| variable | shape | what it's for |
| --- | --- | --- |
| `NODE_ENV` | `development` \| `test` \| `production` | Next.js sets it itself for `dev`/`build`/`start` |
| `NEXT_PUBLIC_API_URL` | absolute URL | the API's base URL that the web app calls (including the `/api` prefix) |
| `AUTH_SECRET` | string, min. 32 characters | Auth.js's key for signing/encrypting the session cookie |
| `AUTH_OKTA_ISSUER` | absolute URL | the same OIDC issuer as the API's |
| `AUTH_OKTA_CLIENT_ID` | non-empty string | the web app's OAuth2 client ID |
| `AUTH_OKTA_CLIENT_SECRET` | non-empty string | the web app's OAuth2 client secret |

### Variables only for `docker-compose.yml`

Neither application reads these – they only configure the `postgres`
container. They must manually match the credentials encoded in
`DATABASE_URL` above (neither is derived from the other).

| variable | what it's for |
| --- | --- |
| `POSTGRES_USER` | the user created inside the `postgres` container |
| `POSTGRES_PASSWORD` | its password |
| `POSTGRES_DB` | the default database |

---

## Where each variable lives (two `.env` files, not one)

`.env.example` is a single file at the repo root, but in practice it produces
**two** copies – running both applications reads variables from different
directories (the detailed reasoning is in
`doc/decision/0009-env-file-topology-and-compose-profiles.md`):

- **root `.env`** – read by `docker compose` (substitution in
  `docker-compose.yml`) and by `apps/garage/api` when run via `nx serve api` (NestJS's
  `ConfigModule` reads `.env` relative to `process.cwd()`, which for this Nx
  executor is the repo root).
- **`apps/garage/web/.env`** – read by `apps/garage/web` when run via `nx run web:dev` /
  `next build` / `next start` (Next.js loads env files relative to its own
  directory, not the repo root).

```bash
cp .env.example .env
cp .env.example apps/garage/web/.env
```

The actual `.env` files are in `.gitignore` – they are never committed.

---

## How to start the local stack

1. Copy the env files (see above).
2. Start the infrastructure (Postgres + mock OIDC; `adminer` additionally in
   the `dev` profile):

   ```bash
   docker compose --profile dev up -d
   ```

   Every service now carries a profile, so `docker compose up` with no
   `--profile` starts **nothing**. That is deliberate: which database you run
   against is a decision, not a default
   (`doc/decision/0208-every-service-carries-a-profile-and-the-database-is-a-choice`).
   `postgres` answers to `dev` and to `db`; the mock OIDC issuer and `adminer`
   answer only to `dev` — the issuer deliberately, so that no production
   invocation can start it and nothing in the `app` profile depends on it
   (`doc/decision/0201-the-issuer-url-must-be-one-name-on-both-sides-of-the-network`).

   `web` and `api` sit behind the **`app`** profile and now build real
   production images (`apps/garage/api/Dockerfile`, `apps/garage/web/Dockerfile`), together
   with a one-shot `migrate` job that applies pending migrations before the
   API starts. They need their own env file, because the addresses inside the
   compose network are not the host's — see `README.md`, §"The containerised
   stack", and `doc/decision/0205-the-app-profile-names-every-variable-it-passes`:

   ```bash
   cp .env.docker.example .env.docker
   docker compose --env-file .env.docker --profile dev --profile app up -d --build
   ```

   For everyday development the applications run on the host instead:

   ```bash
   npx nx run api:serve   # NestJS, port per PORT in .env (default 3000)
   npx nx run web:dev     # Next.js on 4200 — the port is pinned in apps/garage/web/project.json
   ```

3. Verify Postgres is healthy:

   ```bash
   docker compose ps postgres   # STATUS should include "healthy"
   ```

4. Verify the mock OIDC server is running – the discovery document must
   respond:

   ```bash
   curl -s http://localhost:8080/default/.well-known/openid-configuration | head -c 200
   ```

   The expected response includes `"issuer":"http://localhost:8080/default"`
   and URLs for the `authorize`/`token`/`jwks` endpoints. `mock-oauth2-server`
   (image `ghcr.io/navikt/mock-oauth2-server`) runs without a mounted
   `JSON_CONFIG` – the built-in `default` issuer is sufficient for this phase.

5. (Optional) Open Adminer at `http://localhost:8081` and connect to Postgres
   using `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` from `.env`, host
   `postgres`, port `5432`.

The whole file has since been run, both profiles, from an empty volume: Postgres
became healthy, `migrate` applied all three migrations and exited 0, `api`
reported healthy, `web` reported healthy, and a browser completed a real OIDC
sign-in and made authenticated oRPC calls against the API container. To check
the syntax without starting anything (`--env-file` is what supplies the app
profile's values):

```bash
docker compose --profile dev config
docker compose --env-file .env.docker --profile dev --profile app config
```

---

## Demonstrating fail-fast (without Docker)

### API

```bash
# DATABASE_URL is deliberately missing
NODE_ENV=development PORT=3000 \
AUTH_OKTA_ISSUER=http://localhost:8080/default AUTH_OKTA_AUDIENCE=api://default \
CORS_ALLOWED_ORIGINS=http://localhost:4200 LOG_LEVEL=info \
node dist/apps/garage/api/main.js
```

The process exits with `exit code 1` and an `ExceptionHandler` error that
names `DATABASE_URL` and never prints any value. **All** invalid variables are
listed at once, not just the first. The verbatim output is in
`doc/api-operations.md`, section "Behavior on a missing or invalid env
variable" – including the note that this particular output is not JSON yet.

### Web

```bash
cd apps/garage/web
env -i PATH="$PATH" HOME="$HOME" ../../node_modules/.bin/next start -p 4310
```

The server opens its HTTP port, but right afterward the instrumentation hook
notices that `NEXT_PUBLIC_API_URL`, `AUTH_SECRET`, `AUTH_OKTA_ISSUER`,
`AUTH_OKTA_CLIENT_ID`, and `AUTH_OKTA_CLIENT_SECRET` are missing, prints them,
and the process exits with `exit code 1`.

The actual output of both commands (from the development machine, without
Docker) is in
`.superpowers/sdd/implementation-plan/task-2-report.md`.
