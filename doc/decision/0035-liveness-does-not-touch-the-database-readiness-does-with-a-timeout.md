# 0035 – `/health/live` does not touch the database, `/health/ready` does – with a timeout

**Date:** 2026-08-28 · **Status:** accepted

## What

Two probes, two different meanings:

| endpoint | what it does | what failure means |
| --- | --- | --- |
| `/health/live` | nothing – `health.check([])` | the process is stuck → **restart** |
| `/health/ready` | a real `SELECT 1` against Postgres | the instance can't serve → **take out of rotation** |

`SELECT 1` is wrapped in a timeout, `HEALTH_DB_TIMEOUT_MS` (default 3000 ms). If it doesn't
finish in time, the probe fails with the reason `Database did not respond in time`.

The failure reason is deliberately **coarse** – `Database is unreachable`, never the
driver's original error.

Both probes are outside the global prefix `/api` (an exception in `setGlobalPrefix`) and
outside rate limiting (`@SkipThrottle()`), and `nestjs-pino` doesn't write them to the
request log (`exclude`).

## Why

**Why liveness must not touch the database.** If Postgres goes down and liveness touches it,
the orchestrator starts restarting *every* instance of the API. They won't come back up
after the restart (or will come back up and immediately fail again), so a database outage
turns into a restart loop for the whole application – and once the database comes back,
there's also a thundering herd of reconnections. Liveness answers "is this process stuck?",
and the answer to that is "no" even when the database is gone.

**Why readiness, conversely, must touch it.** A readiness probe that returns 200 even when
Postgres is down is worse than no probe at all: a broken deployment looks healthy, and the
orchestrator routes traffic to it that can only produce 500s. This is an explicit
requirement from the brief, not a judgment call.

**Why the timeout.** A stuck Postgres – a full connection pool, a network black hole –
causes `SELECT 1` to never finish. Without a timeout, the probe doesn't get stuck "for a
moment", it gets stuck **forever**, and a stuck probe reads to most orchestrators as "still
starting up", not "broken". That's again the worse of the two possible mistakes. The
timeout has to stay comfortably under the orchestrator's probe timeout, or it will never get
a chance to beat it.

**Why the coarse reason.** `/health/ready` tends to be reachable by a wider circle of people
than the logs. The `pg` driver's error message routinely contains the host, the database
name, and sometimes the user – that's an infrastructure configuration detail, not
information for whoever reads the probe.

**Why the probes sit outside `/api`.** The path to a probe is configured by whoever deploys
the app. Hiding it under a prefix that belongs to the application's routing would tie
deployment configuration to a decision about the API's shape.

## How

`DatabaseHealthIndicator` uses `HealthIndicatorService.check(key)` and `up()`/`down()` (the
`@nestjs/terminus` v11 API, not the inherited `HealthIndicator` from v10). A failed check
surfaces as a `ServiceUnavailableException`, i.e. HTTP 503.

The timer is cleared in `finally` – without that, the process would hold a live timer open
for `HEALTH_DB_TIMEOUT_MS` after *every successful* probe.

`health.spec.ts` runs against a `PrismaService` double with three behaviors (`up` / `down` /
`hang`) and verifies, among other things, that liveness **never calls `ping()`** at all when
the database is broken, that readiness calls it exactly once, and that neither the host nor
the database name appears in the response.

That file, though, calls the controller's methods **directly**, so it says nothing about the
actual HTTP response – and that's exactly where the bug was: the global filter overwrote the
terminus body with a constant (see `doc/decision/0033-*`). What the probe actually returns
is verified by `apps/garage/api/src/app/http-pipeline.spec.ts` with real requests against a running
server. The split is deliberate: `health.spec.ts` tests what the indicator *computes*,
`http-pipeline.spec.ts` tests what the client *gets*.

## Risk if this is wrong

If someone added a database check to `/health/live` "for completeness", it would behave
normally right up until the first Postgres outage – and at that point a database outage
turns into an outage of the entire application, including the restart loop. It's a
one-line change with a disproportionate impact, and in tests it's only caught by the
explicit assertion on `prisma.pings === 0`, which is exactly why that test lives in
`health.spec.ts`.

Second trap: setting `HEALTH_DB_TIMEOUT_MS` **higher** than the orchestrator's probe timeout
disables the whole mechanism – the orchestrator cuts the probe off before it can respond,
and it behaves like a stuck probe, exactly what the timeout is trying to prevent.
