# Production image for apps/garage/web (Next.js).
#
# Build from the repository root — the build needs the whole Nx workspace:
#
#   docker build -f apps/garage/web/Dockerfile -t garage-web .
#
# Two stages:
#
#   builder  the Nx workspace, all dependencies, `nx run web:build`. Because
#            `next.config.ts` sets `output: 'standalone'`, that build also emits
#            `apps/garage/web/.next/standalone` — a server plus exactly the
#            node_modules files the trace found it reaching for.
#   runner   that standalone tree, the static assets and `public/`. Nothing
#            else: no sources, no workspace node_modules, no build tooling.
#
# **No secret is baked in, and none can be.** There is no `ARG` here, and
# `.dockerignore` keeps `.env` out of the build context — which matters more
# than it looks: `next build --output standalone` *copies any `.env` file it
# finds next to the app into `.next/standalone/apps/garage/web/.env`*. On a developer's
# machine that file holds the real `AUTH_SECRET` and the OAuth client secret,
# and it would ride into the image as a readable layer. Keeping it out of the
# context is what stops that; `docker run --rm <image> ls -a apps/garage/web` is how
# you check.
#
# `NEXT_PUBLIC_API_URL` is deliberately *not* a build argument either. Every
# read of it (`app/layout.tsx`, `settings/page.tsx`, `app/api/health/route.ts`)
# happens in server code at request time and is handed to the client as a prop,
# so the value stays a runtime setting and one image serves every environment.

# ---------------------------------------------------------------------------
# builder
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npx nx run web:build --skip-nx-cache

# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runner

ENV NODE_ENV=production
# Next's own default, restated so the HEALTHCHECK has a value to read. The
# standalone server reads PORT and HOSTNAME (defaulting to 0.0.0.0) at startup,
# which is why `web:start` was left honouring PORT rather than pinned the way
# `web:dev` is.
ENV PORT=3000
# Not optional, and not a default. `server.js` binds
# `process.env.HOSTNAME || '0.0.0.0'` — and **Docker sets HOSTNAME** to the
# container's short id for every container it starts. Left alone, the server
# binds that name, which resolves to the container's eth0 address and nothing
# else: reachable from the network, unreachable on loopback. Measured — the
# HEALTHCHECK below failed with `TypeError: fetch failed` against
# `127.0.0.1:3000` while `http://garage-web:3000` answered normally, and
# the container sat `unhealthy` with a perfectly working app inside it.
ENV HOSTNAME=0.0.0.0
# Nothing about a running deployment should phone home.
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# `standalone` carries `node_modules/` at its root and the app at
# `apps/garage/web/server.js`, because `outputFileTracingRoot` is the workspace root
# (see next.config.ts). The two things the trace deliberately does not copy —
# the client-side static chunks and `public/` — are placed where the server
# looks for them: it chdir's to its own directory and reads `./.next`.
# Root-owned and read-only to the user that runs them, so the server cannot
# rewrite its own bundle. (The usual Next.js Docker recipe chowns all of this
# to the app user; with that, `echo x >> apps/garage/web/server.js` from inside the
# running container succeeds.)
COPY --from=builder /workspace/apps/garage/web/.next/standalone ./
COPY --from=builder /workspace/apps/garage/web/.next/static ./apps/garage/web/.next/static
COPY --from=builder /workspace/apps/garage/web/public ./apps/garage/web/public

# The one directory the server legitimately writes to at runtime: Next's
# incremental cache. Nothing else under /app is writable by `node`.
RUN mkdir -p ./apps/garage/web/.next/cache && chown -R node:node ./apps/garage/web/.next/cache

USER node

EXPOSE 3000

# `/api/health` is this app's *readiness* probe: it answers 503 when the API is
# unreachable or not ready (apps/garage/web/src/app/api/health/route.ts). That is the
# right thing for a HEALTHCHECK to report — an instance that cannot reach the
# API renders nothing usable — and it is what makes this check falsifiable:
# stop the API and the container goes `unhealthy`.
#
# `127.0.0.1` rather than `localhost`, and `node -e` rather than curl: same
# reasons as apps/garage/api/Dockerfile.
HEALTHCHECK --interval=15s --timeout=10s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>{process.exit(1)})"]

CMD ["node", "apps/garage/web/server.js"]
