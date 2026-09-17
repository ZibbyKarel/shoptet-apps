# 0066 – The database-backed suite gets its own database, not a rollback

**Date:** 2026-09-02 · **Status:** accepted · **Follows on from:** `doc/decision/0027-*`

## What

`nx run api:test-db` now creates a throwaway PostgreSQL database for the run, applies the committed
migrations to it, points `DATABASE_URL` at it for every spec, and drops it afterwards
(`apps/garage/api/src/testing/database/`, wired as Jest's `globalSetup` / `globalTeardown`).

The developer's seeded `garage` is never written to. Task 12's
`database-contract.db.spec.ts` is carried along and keeps its own rollback discipline; the two are
complementary, not alternatives.

The suite still **refuses to skip** when `DATABASE_URL` is absent — the throw simply moved into
`globalSetup`, and `DATABASE_URL= jest …` exits 1.

## Why

**Task 13's concurrency tests must commit, or they are not tests.** An uncommitted row is invisible
to every other connection, so a race built on rolled-back transactions has nothing to race against.
Every case in `waitlist-concurrency.db.spec.ts` needs two sessions that can actually see each
other's writes.

**Committing leaves residue that cannot be removed.** Promotion writes an `AuditLog` row;
`AuditLog` rejects `DELETE` and `TRUNCATE` by trigger (`doc/decision/0027-*`); those rows carry
`actorUserId` with `ON DELETE RESTRICT`, which then pins the fixture users. There is no order of
deletions that empties the tables again — that is the *point* of the append-only design, and it is
working correctly. So the tests cannot clean up after themselves, and the only remaining option is
to throw the whole database away.

**Why not a schema, or a `TEMPLATE` copy.** A separate schema would need `search_path` to reach
through `@prisma/adapter-pg`, which is not something to bet a suite on. `CREATE DATABASE … TEMPLATE`
requires no other session to be connected to the template, which is false whenever the dev server or
Adminer is running.

**Why the migrations are applied as SQL rather than by `prisma migrate deploy`.** `migrate deploy`
applies a migration directory and records it in `_prisma_migrations`; a throwaway database needs the
first half only. Reading the files directly avoids spawning a CLI inside `globalSetup` and avoids
depending on `prisma.config.ts` resolving from Jest's working directory. It is still not a fixture:
the files read are the real committed migrations, listed from the directory, so a schema change that
would break production breaks this suite too.

## How

- `test-database.ts` — creates, migrates and drops. Database names are generated, matched against
  `^[a-z][a-z0-9_]*$` before being interpolated into `CREATE`/`DROP DATABASE` (which take no bound
  parameters), and prefixed `garage_dbspec_`.
- **Leaks heal themselves.** A run killed between setup and teardown leaves its database behind, so
  setup drops every database matching the prefix before creating its own — with `WITH (FORCE)`, to
  terminate connections a crashed run left open.
- `maxWorkers: 1` alongside the target's `--runInBand`: these specs create their own concurrency
  deliberately, and workers racing on top of that would make a failure impossible to attribute.

## Risk

**The suite now depends on a role with `CREATEDB`.** True of the dev container and of any CI
Postgres started from `docker-compose.yml`; a locked-down shared server would need a grant. Called
out here rather than discovered later.

**A leaked database survives until the next run.** Bounded — one per killed run, named by a prefix
that is swept — and preferable to a teardown that throws and masks the real failure. The sweep only
force-drops a database whose embedded creation timestamp is over an hour old, so two `api:test-db`
runs started around the same time cannot drop each other's still-in-progress database — only a
crashed run's leftover is old enough to qualify (`test-database.ts`'s `isStaleTestDatabase`).

**`globalSetup` mutating `DATABASE_URL` is process-wide.** Deliberate: it is what carries the
isolation to every spec, including Task 12's, which reads the variable itself. Nothing outside this
Jest process sees it.
