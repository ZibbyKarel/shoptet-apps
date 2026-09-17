# 0036 – Logs are always JSON, even in development; no pretty transport

**Date:** 2026-08-28 · **Status:** accepted

## What

`nestjs-pino` writes one JSON object per line to stdout, **in every environment including
development**. `pino-pretty` is not a project dependency. Anyone who wants readable output
in development pipes it themselves:

```bash
npx nx run api:serve | npx pino-pretty
```

`console.log` is not used anywhere in `apps/garage/api`.

Fixed fields on every record: `level` as a **name** (`"info"`, not `30`), `time`,
`app: "api"`, `env`, and the message text under the key `message` (not pino's default
`msg`).

A request log additionally has `req.id` – either the value of the incoming `x-request-id`
header, or a freshly generated UUID. The same value is returned to the client in the
`x-request-id` response header.

The `authorization`, `cookie`, and `set-cookie` headers are **removed** from the record
(`redact` with `remove: true`), not masked.

The `/health/live` and `/health/ready` probes are not written to the request log at all.

## Why

**Why no pretty transport.** `pino-pretty` runs as a transport in a **worker thread**. That's
one more thing to close during graceful shutdown, and one more way to lose the last lines
before the process exits – exactly the lines someone goes looking for after a crash. The
pipe gives a developer identical output without it being in-process.

Second reason: "pretty in development, JSON in production" means dev and production differ
by code, not just by variable values. That's a pattern this project avoids for auth too
(see `doc/environment.md`).

**Why `level` as a name and `message` instead of `msg`.** Pino defaults to writing a numeric
level (`30`) and the key `msg`. Both work, but require a per-project mapping rule in the log
aggregator. Fixed, self-describing keys mean the log can be poured anywhere and read right
away.

**Why `remove: true` and not masking.** Masking leaves a prefix of the value in the record.
For a bearer token, even the prefix is sensitive, and more importantly – there's no reason
for the log to have anything there at all; that the header arrived is already evident from
the fact that the request passed authentication.

**Why the probes aren't logged.** Liveness and readiness run every few seconds, forever. At
`info` level they'd bury every real request under noise. Errors within them aren't lost by
this – those go through the filter and its own logger.

**Why `x-request-id` comes from the incoming header when present.** So that an id set by a
proxy or the web application survives the hop into the API, and a single incident can be
traced across layers. Returning the header back means a user reporting a bug has something
to cite – a string that's greppable in the log.

## How

Actual output (captured from a run, not invented). Captured against a bare HTTP server with
this pino configuration, not against the full application – in real production `res.headers`
is longer, because it carries the full set of headers added by helmet (CSP, HSTS, COOP,
referrer-policy, …). The record's structure is otherwise identical:

```json
{"level":"info","time":1787919198163,"app":"api","env":"production","reservationId":"b1e2...","message":"Reservation created"}
```

```json
{"level":"info","time":1787919198176,"app":"api","env":"production","req":{"id":"0dce0a5c-6c80-4d74-86d4-ac204bb4deaf","method":"POST","url":"/api/reservations","headers":{"host":"127.0.0.1:63307","user-agent":"curl/8","content-type":"text/plain;charset=UTF-8","content-length":"2"}},"res":{"statusCode":201,"headers":{"x-request-id":"0dce0a5c-6c80-4d74-86d4-ac204bb4deaf"}},"responseTime":1,"message":"request completed"}
```

The request carried `authorization: Bearer secret-token` and `cookie: session=abc`; neither
appears in the record.

The request line's level is decided by `customLogLevel`: 5xx or a thrown error → `error`,
4xx → `warn`, otherwise `info`.

## Risk if this is wrong

The log only gains structure once `main.ts` calls `app.useLogger(app.get(Logger))`.
**Everything that fails before that point looks different** – specifically, a failed env
validation prints colored Nest text, not JSON (see the example in
`doc/api-operations.md`). `bufferLogs: true` delays Nest's startup lines so there are as few
of them as possible, but a validation failure can't be delayed – it happens while
`AppModule` is being evaluated. Whoever collects logs by machine has to account for the fact
that the very first lines of a crashing process might not be JSON.

Second risk: `redact` is a list of **paths**, not name patterns. A new header or field
carrying a secret (say, `x-api-key` or a request body) doesn't get redacted on its own – it
has to be added to the list by hand.
