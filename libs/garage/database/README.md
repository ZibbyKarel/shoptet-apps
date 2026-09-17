# `@garage/database`

Prisma 7 schema, migrations, seed and the generated Prisma Client — the only way
the backend reaches Postgres. No NestJS here: the module and `PrismaService` that
wrap this live in `apps/garage/api` (Tasks 10 and 12).

Full documentation is `doc/database.md`: ERD, every constraint and why
it exists, how to run migrations and the seed, and how to take a backup.

## Layout

| path                              | what it is                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`            | the domain model — mirrors `libs/garage/contract/src/schemas/entities.ts`                             |
| `prisma/migrations/`              | SQL migrations; the init migration carries hand-written CHECK constraints and the append-only trigger |
| `src/generated/prisma/`           | generated client — committed, never hand-edited                                                       |
| `src/lib/create-prisma-client.ts` | the single place a `PrismaClient` is built (driver adapter)                                           |
| `src/lib/seed-data.ts`            | seed data as plain data, so it can be tested without a database                                       |
| `src/scripts/seed.ts`             | the idempotent script that writes it                                                                  |

## Commands

All Prisma commands run from the **repo root** (`prisma.config.ts` lives there and
knows where the schema is):

```bash
npx prisma validate            # no database needed
npx prisma generate            # no database needed; commit the result
npx prisma migrate deploy      # apply migrations
npx prisma db seed             # dev data
nx test database               # unit tests (no database needed)
```

Changing the schema? Read the `--create-only` note in `doc/database.md` first — a
plain `prisma migrate dev` will try to drop the hand-written constraints.
