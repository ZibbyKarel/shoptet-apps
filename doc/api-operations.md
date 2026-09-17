# API operations – logging, probes, shutdown, security baseline

This document describes the **operational baseline of `apps/garage/api`**: what happens at
startup, what gets logged, what the health probes answer, how the process terminates
cleanly, and what the API guards on input. The source of truth is the code; when they
disagree, trust the code.

Env variable configuration (including defaults) is in `doc/environment.md`.

---

## What the operational baseline covers

| area | where it lives | note |
| --- | --- | --- |
| fail-fast env validation | `apps/garage/api/src/env.ts` | Zod, runs inside `ConfigModule.forRoot({ validate })` |
| structured logging | `apps/garage/api/src/logging/logger.options.ts` | `nestjs-pino`, JSON, `doc/decision/0036-*` |
| health probes | `apps/garage/api/src/health/` | `@nestjs/terminus`, `doc/decision/0035-*` |
| graceful shutdown | `apps/garage/api/src/shutdown/` | `GracefulShutdownService` |
| global error filter | `apps/garage/api/src/common/filters/` | `doc/decision/0032-*`, `doc/decision/0033-*` |
| rate limiting | `apps/garage/api/src/common/throttling/` | `@nestjs/throttler`, `doc/decision/0034-*` |
| helmet, CORS, prefix, body limit | `apps/garage/api/src/configure-app.ts` | called by both `main.ts` and the tests |

What's **not** here and isn't meant to be: Sentry, metrics, APM, alerting, Redis, BullMQ,
or any message broker. Structured logging, probes, and graceful shutdown are operational
hygiene, not monitoring.

### How it's tested

The HTTP wiring (prefix, helmet, CORS, parsers, shutdown hooks) is deliberately pulled out
into `apps/garage/api/src/configure-app.ts`, so that `main.ts` and the tests call it through the
**same function**. `apps/garage/api/src/app/http-pipeline.spec.ts` then starts a real Nest server
on a random port and fires real requests against it.

This isn't cosmetic. Two bugs this baseline shipped with – a 413 returned as a 500, and an
overwritten readiness-probe body – were both **invisible to a test that calls the
controller method directly**, because both only arose from the composition (body parser →
filter, terminus → filter). A test that assembles its own pipeline would also have diverged
from `main.ts` and hidden them just as well. Hence the one shared function.

**Rule:** any claim about what the API returns over the wire belongs verified in
`http-pipeline.spec.ts`. Reasoning about the code isn't enough – both bugs above sounded
convincing and were wrong.

---

## Behavior on a missing or invalid env variable

Validation runs inside `ConfigModule.forRoot({ validate: validateApiEnv })`, i.e. while
`AppModule` is being evaluated – **before the process starts listening on a port**. *All*
invalid variables are printed at once, each with what's wrong with it, and the process
exits with `exit code 1`.

Actual output (missing `DATABASE_URL`, `BODY_LIMIT` is `100` with no unit):

```
[Nest] 41685  - 08/28/2026, 2:12:32 PM     LOG [NestFactory] Starting Nest application...
[Nest] 41685  - 08/28/2026, 2:12:32 PM   ERROR [ExceptionHandler] Error: Invalid or missing environment variables for api. Fix these and restart:
  - DATABASE_URL: Invalid input: expected string, received undefined
  - BODY_LIMIT: must be a byte size with a unit, e.g. "100kb"
    at Object.validateApiEnv [as validate] (dist/apps/garage/api/main.js:3098:15)
    …
```

Two things worth remembering here:

- **The message never prints the variable's value**, only its name and what was expected.
  It's therefore safe to paste into a ticket or a chat.
- **This output is not JSON.** Pino is only installed in `main.ts` via
  `app.useLogger(app.get(Logger))`, which never gets a chance to run when validation fails.
  See "Risk" in `doc/decision/0036-*`.

Reproducing this without Docker: build (`npx nx build api`) and run
`node dist/apps/garage/api/main.js` with an incomplete environment – instructions in
`doc/environment.md`, the "Demonstrating fail-fast" section.

---

## What a log record looks like

One JSON object per line, on stdout. An application line:

```json
{"level":"info","time":1787919198163,"app":"api","env":"production","reservationId":"b1e2...","message":"Reservation created"}
```

A completed-request line (captured against a bare server with this pino configuration – in
real production, `res.headers` additionally carries the full set of headers added by
helmet):

```json
{"level":"info","time":1787919198176,"app":"api","env":"production","req":{"id":"0dce0a5c-6c80-4d74-86d4-ac204bb4deaf","method":"POST","url":"/api/reservations","headers":{"host":"127.0.0.1:63307","user-agent":"curl/8","content-length":"2"}},"res":{"statusCode":201,"headers":{"x-request-id":"0dce0a5c-6c80-4d74-86d4-ac204bb4deaf"}},"responseTime":1,"message":"request completed"}
```

Fixed fields:

| field | value |
| --- | --- |
| `level` | the level's name (`info`, `warn`, `error`), not a number |
| `message` | the message text – not pino's default `msg` |
| `app` | always `"api"` |
| `env` | the value of `NODE_ENV` |
| `req.id` | the request's correlation id |

**Correlation.** `req.id` is the value of the incoming `x-request-id` header, if one
arrived, otherwise a new UUID. The same value is returned in the response's `x-request-id`
header – so a user reporting a bug has something to cite, and it's greppable.

Exception: `genReqId` runs inside the pino-http middleware, which is disabled for both
health probes (`exclude`, see below). **Responses from `/health/live` and `/health/ready`
therefore carry no `x-request-id` header.** That's a consequence of the probes not being
logged, not an oversight.

**Redaction.** The `authorization`, `cookie`, and `set-cookie` headers are removed from the
record. In the example above, the request carried `authorization: Bearer secret-token` and
`cookie: session=abc`; neither appears in the log. Careful: redaction is a list of
**specific paths** – a new header carrying a secret has to be added by hand
(`apps/garage/api/src/logging/logger.options.ts`).

**A credential in the URL is a separate job.** The ICS feed
(`GET /api/calendar/<token>.ics`, `doc/ics.md`) authenticates with a token in the path, and
a path reaches the log through four routes, not one: `req.url` and `req.params` in the
request line above, and `path` and `reason` in `ContractExceptionFilter`'s `Request
rejected` line – `reason` because Nest's 404 message for an unrouted URL is
`Cannot GET <url>`. All four go through `redactIcsToken`
(`apps/garage/api/src/logging/redact-ics-token.ts`), which replaces the segment after
`/api/calendar/` with `[redacted]`, case-insensitively because Express's router matches
paths case-insensitively. `req.params` is not redacted but **dropped**: what lands there is
the logging middleware's own catch-all splat, a second copy of the URL in a shape no
redaction of `url` would reach.

`calendar-logging.spec.ts` is the only spec in the workspace that reads emitted log lines –
it boots the app at `LOG_LEVEL: 'info'` with a captured destination. Every other spec pins
`LOG_LEVEL: 'fatal'`, so a claim about log contents that has no test in that file has
nothing behind it.

**Level of a request line:** 5xx or a thrown error → `error`, 4xx → `warn`, otherwise
`info`.

**Health probes are not written to the request log** – they'd run every few seconds and
bury actual traffic.

For readable output in development: `npx nx run api:serve | npx pino-pretty`. `pino-pretty`
is **not** a project dependency, reasons in `doc/decision/0036-*`.

---

## Health probes

Both are **outside the global prefix `/api`** – deployment configuration shouldn't be tied
to the application's routing. The paths are therefore `http://host:PORT/health/live` and
`/health/ready`, not `/api/health/…`. Both are also exempt from rate limiting.

### `GET /health/live`

**Does not** and must not touch the database. Answers the question "is this process stuck?".
Returns 200 even when Postgres is completely down.

Failure means: the orchestrator should **restart** the process.

### `GET /health/ready`

Performs a **real `SELECT 1`** against Postgres (`PrismaService.ping()`), wrapped in a
timeout of `HEALTH_DB_TIMEOUT_MS` (default 3000 ms).

Failure means: the orchestrator should **take the instance out of rotation**, not restart
it. Signaled with HTTP **503** (`ServiceUnavailableException`).

Response when the database is unreachable (HTTP 503, captured with a real request against
the built application – `apps/garage/api/src/app/http-pipeline.spec.ts`):

```json
{"status":"error","info":{},"error":{"database":{"reason":"Database is unreachable","timeoutMs":3000,"status":"down"}},"details":{"database":{"reason":"Database is unreachable","timeoutMs":3000,"status":"down"}}}
```

Response when the database is fine (HTTP 200):

```json
{"status":"ok","info":{"database":{"responseTimeMs":0,"status":"up"}},"error":{},"details":{"database":{"responseTimeMs":0,"status":"up"}}}
```

The reason is deliberately coarse – the `pg` driver's error message contains the host, the
database name, and sometimes the user, and `/health/ready` tends to be reachable by a wider
circle of people than the logs are. On a timeout, `reason` is instead
`Database did not respond in time`.

> **Careful when touching the filter.** The health check's body is the **only** 5xx body
> that `ContractExceptionFilter` lets through unchanged; every other one gets replaced by a
> constant (see `doc/decision/0033-*`). The filter's original version had no such exception,
> so the probe correctly returned 503, but with the body
> `{"statusCode":500,"message":"Internal server error"}` – the right status class, worthless
> content. Only a real request exposed it; a test calling the controller method directly
> could not have seen it.

**`HEALTH_DB_TIMEOUT_MS` must stay comfortably under the orchestrator's probe timeout.** A
higher value disables the mechanism: the orchestrator will cut the probe off before it gets
a chance to answer.

Why this particular split, and why the timeout: `doc/decision/0035-*`.

---

## Graceful shutdown

`main.ts` calls `app.enableShutdownHooks()` **before** `listen()`, so that a SIGTERM
arriving during startup is handled too. On SIGTERM/SIGINT, Nest then: stops accepting new
connections → lets in-flight requests finish → calls `onModuleDestroy` (where
`PrismaService` closes its connection pool) → calls `onApplicationShutdown`.

### The hook Task 15 should use

```
GracefulShutdownService.registerCloser
```

(`apps/garage/api/src/shutdown/graceful-shutdown.service.ts`)

Socket.io doesn't close itself. A live WebSocket isn't an "in-flight request", so the HTTP
shutdown doesn't touch it, and the process hangs around until the orchestrator's kill
timeout. The gateway must therefore register itself:

```ts
// in the gateway's onModuleInit, or in its module's constructor
gracefulShutdown.registerCloser('socket.io', async () => {
  await new Promise<void>((resolve) => this.server.close(() => resolve()));
});
```

Properties you can rely on:

- Closers run in `onApplicationShutdown`, i.e. after HTTP has stopped accepting
  connections.
- Each one is **awaited** and **individually caught** – a closer that throws gets logged,
  and the others still run to completion. A half-closed process is worse than a noisy log.
- Registering the same name a second time **replaces** the previous closer, so a module
  that reinitializes doesn't end up duplicating closers.
- A closer must always finish or fail – **never hang**. Shutdown waits for it.

---

## Errors on the way out

The global filter `ContractExceptionFilter` is registered via `APP_FILTER` in `AppModule`
(not via `useGlobalFilters` in `main.ts`), so that tests which only bootstrap the module
get it too.

**The stack trace is always logged and never sent to the client.**

A domain error looks like this (the oRPC shape the frontend client understands):

```json
{"defined":false,"code":"SPOT_ALREADY_RESERVED","status":409,"message":"…","data":{}}
```

Transport failures (a route that doesn't exist, a request dropped by the throttler, a body
over the limit) and unknown errors keep Nest's shape, `{ statusCode, message }`; for an
unknown error the body is the constant
`{"statusCode":500,"message":"Internal server error"}`.

The most important mapping: the unique constraint on `Reservation (parkingSpotId, date)` is
what makes a double booking impossible under concurrency. The losing request in that race
gets `SPOT_ALREADY_RESERVED` (409), not 500. Details and the full mapping table:
`doc/decision/0032-*`; response shapes: `doc/decision/0033-*`.

---

## Rate limiting, helmet, CORS, body limit

**Rate limiting.** A single throttler is registered: `THROTTLE_LIMIT` requests per
`THROTTLE_TTL_MS` (default 300 / minute), globally via `APP_GUARD`.

A stricter tier for endpoints **without a session** – the `StrictThrottle()` decorator in
`apps/garage/api/src/common/throttling/throttle-tiers.ts` (`THROTTLE_STRICT_LIMIT` /
`THROTTLE_STRICT_TTL_MS`, default 20 / minute). **Task 14 applied it, and it is on exactly one
route**: the personal ICS feed, which is the only endpoint reachable without a token at all
(`doc/ics.md`).

```ts
@Public()
@StrictThrottle()
@Controller('calendar')
export class CalendarController { … }
```

That it actually fires is verified rather than assumed – `calendar-pipeline.spec.ts` boots an
application with `THROTTLE_STRICT_LIMIT=2`, gets `200, 200, 429` from the feed in sequence, and
reads `x-ratelimit-limit: 2` there against `100000` on an RPC route in the same process. Removing
the decorator fails that test.

The health probes remain `@SkipThrottle()`.

Registering it as a second named throttler is **not possible** – `@nestjs/throttler`
applies every registered throttler to every route, so the strict limit would end up
applying to the entire API. See `doc/decision/0034-*`.

Counters are in-memory. That matches the MVP's single-instance target; at scale the limit
would be multiplied by the number of instances, and the fix is swapping `ThrottlerStorage`,
not changing this structure.

> **Limitation: the API currently rate-limits by socket IP.** `ThrottlerGuard` buckets by
> `req.ip`, and Express takes it from the socket because **`trust proxy` isn't set**. Behind
> a reverse proxy (nginx, traefik, ingress), all clients therefore fall into **one** bucket,
> and `THROTTLE_LIMIT` becomes a shared budget for the entire user base – one noisy client
> cuts everyone else off.
>
> Before the API is deployed behind a proxy, this has to be resolved: `app.set('trust
> proxy', …)` with a **hop count or a CIDR range**, never a bare `true` – that would let a
> client spoof `X-Forwarded-For` and dodge the limit entirely. Task 10 doesn't set this,
> because the deployment topology isn't decided yet and a wrong value is worse than none.

**Helmet** is enabled with its default configuration (`app.use(helmet())`).

**CORS** is an explicit allow-list from `CORS_ALLOWED_ORIGINS`, `credentials: true`. Never
`origin: true` or `*` – the API authenticates via cookie/bearer, so a reflected origin would
be a CSRF surface.

**Body limit** is `BODY_LIMIT` (default `100kb`) for both JSON and urlencoded. Nest's own
body parser is disabled (`bodyParser: false` in `NestFactory.create`), so that exactly one
set of parsers is registered and order doesn't matter. The schema rejects a `BODY_LIMIT`
with no unit: to the body-parser, `100` means *bytes*, which is almost never what someone
meant to write.

An oversized body gets **413** (captured with a real request):

```json
{"statusCode":413,"message":"request entity too large"}
```

> **Careful when touching the filter.** The body parser doesn't throw an `HttpException`,
> but a `PayloadTooLargeError` from the `http-errors` library. The filter's original version
> didn't recognize it, so it fell through into the "unexpected error" branch and returned
> **500 with a logged stack** – the wrong status class, and simultaneously a way for an
> anonymous caller to flood the error log. The filter now recognizes it by the `expose` flag,
> which `http-errors` itself uses to mark messages safe for the client. See
> `doc/decision/0033-*`.

**Secrets come exclusively from the env** – there is no hard-coded value anywhere in the
repository.
