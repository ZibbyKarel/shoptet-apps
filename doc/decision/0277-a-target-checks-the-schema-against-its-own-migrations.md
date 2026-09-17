# 0277 – A target checks the schema against its own migrations and its own generated client

## What

`nx run database:check-schema` (`libs/garage/database/project.json`), four commands in
order:

```
prisma migrate status
prisma migrate diff --from-config-datasource \
  --to-schema libs/garage/database/prisma/schema.prisma --exit-code
prisma generate
git diff --exit-code -- libs/garage/database/src/generated
```

It needs a live PostgreSQL and `DATABASE_URL`, so it is **not** part of
`nx run-many -t lint,typecheck,test,build`. **It needs adding to CI's `database`
job**, which already has the `postgres:17` service and already runs
`prisma migrate deploy` — see Risk.

## Why

- **Nothing verified `schema.prisma`.** Both suites that call themselves parity
  checks compare artefacts *derived from* it:
  - `schema-contract-parity.spec.ts` compares the **committed generated Prisma
    client** against the contract, and says so in its own header. Nothing
    regenerated that client in CI and nothing diffed it against the schema:
    `database:prisma-generate` existed but **nothing depended on it** — no
    reference from `nx.json`, `package.json`, `.github/`, `apps/garage/api/project.json`
    or either Dockerfile. Edit the schema without regenerating and that spec
    compares a stale client against the contract, and passes.
  - `migration-sql.spec.ts` never read `schema.prisma` at all.

  The one artefact authoritative for both was checked by neither. All three
  agreed at the time this was written; **the defect was the missing guard, not a
  mismatch.**
- **The two halves fail independently, and both were provoked.** Adding a
  `nickname String?` field to `User` fails the second command (`[+] Added column
  nickname`, exit 2). Adding a `///` doc comment — which changes the generated
  client's `inlineSchema` but produces no SQL — passes the second command and
  fails the fourth. Neither is caught by anything else in the repository.
- **`migrate status` is not decoration.** `--from-config-datasource` compares
  the *live* database against the schema, so it is only a statement about the
  migrations if the database is exactly at migration head. `migrate status`
  is what establishes that, including that no already-applied migration file has
  been edited since (Prisma checksums them).
- **`--from-migrations` was tried and rejected.** It is the more hermetic form —
  it replays the history into a throwaway database — but Prisma requires
  `datasource.shadowDatabaseUrl` in `prisma.config.ts` and then **refuses to
  create** the named database (`P1003: Database garage_shadow does not
  exist`). Configuring one would also change `prisma migrate dev` for every
  developer, which is a real regression to buy a marginal improvement over
  `migrate status` + `--from-config-datasource`. `prisma.config.ts` is therefore
  unchanged.
- **`migration-sql.spec.ts` now covers part of the same ground without a
  database.** It reconciles the enum members the migrations actually produce —
  the init `CREATE TYPE` plus every `ADD VALUE` in every later migration —
  against the members `schema.prisma` declares. That is the drift the six-member
  `CREATE TYPE` versus the eight-member enum made possible, and it runs in
  `npm test`.

## How

- `parallel: false`, so the commands run in order and the first failure stops
  the target. `--exit-code` makes `migrate diff` exit `2` on a difference and
  `1` on an error; both fail the target, which is correct.
- `git diff --exit-code -- libs/garage/database/src/generated` is the honest form of
  "the committed client is current": it compares what `prisma generate` just
  produced against what is committed. In a clean CI checkout that is exactly the
  question. **Locally it will fail while a legitimate schema edit's regenerated
  client is still uncommitted** — commit it and the target goes green.
- `database:prisma-generate`'s `inputs` were `["{projectRoot}/prisma/schema.prisma"]`,
  which **replaced** Nx's default input set instead of extending it. Measured:
  with that list, touching `libs/garage/database/README.md` still produced a cache hit;
  with `["default", { "externalDependencies": ["prisma", "@prisma/client"] }]` it
  re-runs, and a Prisma version bump now misses the cache too.

## Risk

- **This target is not yet in CI, and the fix is incomplete until it is.**
  `.github/` is owned by another agent in this review round. The step to add to
  the `database` job, after `prisma migrate deploy`, is exactly:

  ```yaml
  - run: npx nx run database:check-schema
  ```

  It needs no service beyond the one the job already starts and no environment
  beyond the `DATABASE_URL` the job already exports.
- **It cannot run without a database**, so it will not catch drift on a laptop
  with Compose down. That is inherent to comparing against a datasource, and the
  enum reconciliation in `migration-sql.spec.ts` is the part that runs anywhere.
- **`git diff` presumes a clean tree for the generated directory.** A developer
  with unrelated uncommitted changes under `src/generated` — which should never
  happen, since it is generated — sees a confusing failure.
