# 0200 – Production images run non-root over code they cannot write

## What

`apps/garage/api/Dockerfile` and `apps/garage/web/Dockerfile` are multi-stage builds on
`node:24-alpine` whose final stage:

- runs as the base image's `node` user (uid 1000), never root;
- carries application files owned by **root**, readable but not writable by
  that user — the opposite of the usual `COPY --chown=node:node` recipe;
- declares a `HEALTHCHECK` against the app's own **readiness** route, run by
  `node -e` rather than curl.

The API's final stage holds `main.js`, its pruned `node_modules` and nothing
else; the web app's holds Next's standalone output, the static chunks and
`public/`.

## Why

- **Non-root is the floor, not the ceiling.** `USER node` alone still leaves the
  process able to rewrite its own bundle, because `--chown=node:node` on the
  COPY hands it ownership. That is not a hypothetical: with the chown in place,
  `docker exec … sh -c 'echo x >> /app/main.js'` succeeded inside the running
  container. Root-owned files and a non-root user make the same command answer
  `Permission denied`, which is what "the container is immutable" is supposed to
  mean. The one exception is `apps/garage/web/.next/cache`, which Next writes to at
  runtime and which is created and chowned explicitly.
- **Readiness, not liveness, is what a compose `HEALTHCHECK` should report.**
  `depends_on: condition: service_healthy` reads it, and an API that is up but
  cannot reach Postgres must not be treated as ready to receive the web app's
  traffic. `/health/ready` answers 503 in that case; `/health/live` deliberately
  answers 200, because restarting a process cannot fix a database outage
  (`apps/garage/api/src/health/health.controller.ts`, `doc/decision/0035-*`).
- **`/health/ready`, not `/api/health/ready`.** `configureApp()` passes the
  health prefix to `setGlobalPrefix`'s `exclude`, so the probes sit at the
  server root. A health check built off the `/api` prefix is red on a perfectly
  healthy deployment — measured in `doc/decision/0101-*` as a 404.
- **`127.0.0.1`, not `localhost`.** The literal is immune to /etc/hosts and to a
  container with IPv6 loopback but no IPv4 listener.
- **`node -e`, not curl or wget.** Node is already in the image. Installing a
  package into a runtime image so a health check can make one HTTP request adds
  attack surface for no gain.

## How

- `apps/garage/api/Dockerfile` — stages `builder` → `runtime-deps` → `runner`, plus a
  separate `migrator` (`doc/decision/0204-*`). `HEALTHCHECK` on
  `http://127.0.0.1:${PORT}/health/ready`.
- `apps/garage/web/Dockerfile` — stages `builder` → `runner`. `HEALTHCHECK` on
  `http://127.0.0.1:${PORT}/api/health`, the web app's own readiness probe for
  the pair (`doc/decision/0103-*`).
- `.nvmrc` pins the Node major that both images, CI and local development share.

Verified in the running containers, not in the Dockerfiles:

```
$ docker exec …-api-1 id
uid=1000(node) gid=1000(node) groups=1000(node)
$ docker exec …-api-1 sh -c 'echo x >> /app/main.js'
sh: can't create /app/main.js: Permission denied
$ docker stop …-postgres-1      # then, within 40s
api=unhealthy   /health/ready → 503, /health/live → 200
```

## Risk

- **Alpine/musl.** Both images run on musl. Nothing in either bundle is a native
  addon that lacks a musl build (the Prisma client here is generated TypeScript
  with a driver adapter, not an engine binary — `doc/decision/0024-prisma-client-inside-libs-database-and-committed`),
  and both images were built and served. A future native dependency would have
  to be re-checked, and `node:24-bookworm-slim` is the fallback.
- **A read-only application directory forbids a future feature that writes
  beside its code** — an uploaded file, a generated asset. That is a volume's
  job, and having to notice is the point.
