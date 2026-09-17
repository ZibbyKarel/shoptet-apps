# Production image for apps/garage/api (NestJS).
#
# Build from the repository root, because the build needs the whole Nx
# workspace (`libs/*`, `tsconfig.base.json`, the lockfile):
#
#   docker build -f apps/garage/api/Dockerfile -t garage-api .
#
# Three stages, and each exists for a reason:
#
#   builder      the Nx workspace, all dependencies, `nx run api:build`.
#                Webpack emits a single bundled `dist/apps/garage/api/main.js` plus a
#                *pruned* `package.json`/`package-lock.json` naming only the
#                packages the bundle still requires at runtime
#                (`generatePackageJson: true` in apps/garage/api/webpack.config.js).
#   runtime-deps `npm ci` against that pruned lockfile — ~29 packages instead
#                of the workspace's full tree, and no build tooling.
#   runner       the bundle plus those modules. Nothing else: no sources, no
#                lockfile of the workspace, no npm cache, no `.env`.
#
# **No secret is baked in.** There is no `ARG` in this file and nothing reads
# `.env` (`.dockerignore` keeps it out of the context entirely). Every value
# the process needs — `DATABASE_URL`, `AUTH_OKTA_*`, `CORS_ALLOWED_ORIGINS` —
# arrives from the environment at `docker run` time.
#
# The Prisma client is *committed* to `libs/garage/database/src/generated/prisma` and
# is pure TypeScript (`provider = "prisma-client"`, `runtime = "nodejs"`,
# driver adapter `@prisma/adapter-pg`), so it is bundled into `main.js` like
# any other module: no `prisma generate` step here, and no query-engine binary
# to carry. Migrations are a separate concern and are *not* run by this image —
# see the `migrate` service in docker-compose.yml.

# ---------------------------------------------------------------------------
# builder
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /workspace

# Dependencies first: this layer is reused for every build in which the
# lockfile has not moved, which is nearly all of them. `npm ci` honours the
# `allowScripts` allow-list in package.json (npm >= 11.6), so only the seven
# packages named there may run install scripts.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `--skip-nx-cache`: the Nx cache directory is not in the image and a remote
# cache is not configured, so the flag only removes a pointless lookup — but it
# also makes it impossible for a stale `.nx` copied in by a future, looser
# .dockerignore to answer for a real build.
RUN npx nx run api:build --skip-nx-cache

# ---------------------------------------------------------------------------
# runtime-deps
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime-deps

WORKDIR /app

COPY --from=builder /workspace/dist/apps/garage/api/package.json ./package.json

# `npm install`, not `npm ci` — and that is a finding, not a preference.
# Webpack emits a pruned `package-lock.json` alongside the manifest, but the
# two do not agree: `npm ci` against them fails with
# `Missing: content-type@1.0.5 from lock file`, because the pruner leaves
# express 5 (nested under @nestjs/platform-express) resolving its
# `content-type` to an entry that is shadowed by the 2.1.0 copy beside it. Nx's
# own `api:prune`/`prune-lockfile` targets, which exist for this, cannot run in
# this workspace either: `@nx/js:prune-lockfile` wants `apps/garage/api/package.json`,
# and this workspace is project.json-only (doc/decision/0006-*).
#
# The cost is honest and bounded: every *direct* dependency is exact-pinned by
# the generated manifest (29 of them, all `x.y.z`, no ranges), so only
# transitive versions are resolved at build time. The alternative — `npm ci
# --omit=dev` against the workspace lockfile — is fully locked but installs the
# web app's tree as well: 766 MB and 447 packages against 137 MB and 195 here,
# both measured. See doc/decision/0203-*.
#
# `--ignore-scripts` is not belt-and-braces: nothing in this set needs to run
# code at install time, and an image build is exactly where an install script
# should not be able to.
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

# ---------------------------------------------------------------------------
# migrator — `prisma migrate deploy`, and nothing else
# ---------------------------------------------------------------------------
#
# A one-shot image, built with `--target migrator` and run to completion before
# the API starts (`migrate` in docker-compose.yml). Kept out of `runner` on
# purpose: an application process that can rewrite its own schema is an
# application process that will, on some restart nobody planned, and the CLI is
# 40 MB of build tooling that a serving container has no use for.
#
# `migrate deploy`, never `migrate dev` and never `migrate reset`: deploy
# applies pending migrations and refuses to invent or destroy any. It seeds
# nothing either — `libs/garage/database/src/scripts/seed.ts` says "development seed"
# in its first line, and it is run from a checkout (see README.md).
FROM node:24-alpine AS migrator

WORKDIR /app

# `USER node` *before* the install, not after. A `chown -R` over an installed
# node_modules rewrites every file into a second layer — measured here at
# 1.24 GB for the image against 393 MB for this ordering. Installing as the
# user that will run keeps one copy and needs no chown at all.
RUN chown node:node /app
USER node

# Versions pinned to the workspace lockfile's resolutions, so this is the same
# CLI a developer runs. `--no-save` because nothing here is a package, and the
# cache is dropped in the same layer that fills it.
RUN npm install --no-save --ignore-scripts --no-audit --no-fund \
  prisma@7.10.0 dotenv@17.4.2 \
  && npm cache clean --force

# `prisma.config.ts` resolves the schema as
# `join(import.meta.dirname, 'libs', 'database')`, so the two have to keep this
# relative layout.
COPY --from=builder /workspace/prisma.config.ts ./prisma.config.ts
COPY --from=builder /workspace/libs/garage/database/prisma ./libs/garage/database/prisma

CMD ["npx", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runner

ENV NODE_ENV=production
# Overridable, and overridden by docker-compose. Named here so the HEALTHCHECK
# below has a value to read even when the caller sets nothing.
ENV PORT=3000

WORKDIR /app

# Left owned by **root** and merely readable by the user that runs it, so the
# process cannot rewrite its own code. This is the opposite of the usual
# `COPY --chown=node:node` recipe, and the difference is measurable: with
# `--chown`, `docker exec … sh -c 'echo x >> /app/main.js'` inside the running
# container succeeds.
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=builder /workspace/dist/apps/garage/api/package.json ./package.json
COPY --from=builder /workspace/dist/apps/garage/api/main.js ./main.js

# The `node` user (uid 1000) ships with the base image. Everything after this
# line runs as it — including the HEALTHCHECK.
USER node

EXPOSE 3000

# Readiness, not liveness: this is what `depends_on: condition: service_healthy`
# reads, and a container that is up but cannot reach Postgres must not be
# treated as ready to receive the web app's traffic. `/health/ready` answers 503
# in that case (apps/garage/api/src/health/health.controller.ts), which `r.ok` turns
# into exit 1 — a real failure signal, not a probe that is green whenever the
# port is open.
#
# `127.0.0.1`, not `localhost`: the literal is immune to whatever /etc/hosts
# says, and to a container that has IPv6 loopback but no IPv4 listener.
#
# `/health/ready`, not `/api/health/ready` — `configureApp()` passes the health
# prefix to `setGlobalPrefix`'s `exclude`, so the probes sit at the server root.
#
# `node -e` rather than curl or wget: node is already here, and adding a package
# to a runtime image so that a health check can make one HTTP request is a
# larger attack surface than the check is worth.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>{process.exit(r.ok?0:1)}).catch(()=>{process.exit(1)})"]

CMD ["node", "main.js"]
