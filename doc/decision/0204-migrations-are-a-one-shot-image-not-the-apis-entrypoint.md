# 0204 – Migrations are a one-shot image, not the API's entrypoint

## What

`apps/garage/api/Dockerfile` has a fourth stage, `migrator`, whose whole job is
`prisma migrate deploy`. `docker-compose.yml` runs it as the `migrate` service,
and `api` waits for it with `condition: service_completed_successfully`. The
API image contains no Prisma CLI, no schema and no migrations, and its
entrypoint runs no migration.

## Why

- **A serving process that can rewrite its own schema eventually will**, on some
  restart nobody planned, and on more than one replica at once. Separating them
  makes "apply migrations" an explicit step with its own exit code, which is
  also the shape a real deployment wants: run the job, then roll the app.
- **`api` starting only after the job exits 0** means a container is never
  serving against a schema it does not match. `depends_on` expresses that
  directly; an entrypoint script would have to reimplement the wait.
- **`migrate deploy`, never `migrate dev` and never `migrate reset`.** Deploy
  applies what is already in `libs/garage/database/prisma/migrations` and generates
  nothing. `reset` destroys data and has no business in an image at all.
- **It seeds nothing.** `libs/garage/database/src/scripts/seed.ts` says "Development
  seed" in its first line; it is run from a checkout, by a person, against a
  development database (`README.md`, `doc/database.md`).
- **The CLI is 40 MB of build tooling** plus, transitively, Prisma Studio's
  dependencies. A serving container has no use for any of it.

## How

- `apps/garage/api/Dockerfile`, stage `migrator`: `prisma@7.10.0` and `dotenv@17.4.2`
  pinned to the workspace lockfile's resolutions, `prisma.config.ts` and
  `libs/garage/database/prisma` copied so the config's
  `join(import.meta.dirname, 'libs', 'database')` still resolves.
- `USER node` is set **before** the install, not after. A `chown -R` over an
  installed `node_modules` rewrites every file into a second layer: measured at
  1.24 GB for the image, against 532 MB with the install done as the user that
  runs it.
- Built with `--target migrator`; `docker-compose.yml` names that target.

Measured on a clean volume: postgres healthy → `migrate` applied all three
migrations and exited 0 → `api` started and reported healthy.

## Risk

- **A migration that needs a rollback is a human decision**, and this job has no
  opinion about it. That is deliberate; `doc/database.md` covers the procedure.
- **Two images to publish instead of one**, from the same Dockerfile and the
  same build. The alternative — a third Dockerfile — would drift from the
  builder stage that produces both.
