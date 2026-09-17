/**
 * Prisma 7 configuration.
 *
 * Prisma 7 moved connection URLs out of `schema.prisma` and stopped loading
 * `.env` on its own, so both live here. The file sits at the repo root because
 * that is where the Prisma CLI looks for it and where the root `.env` lives
 * (see `doc/decision/0009-env-file-topology-and-compose-profiles.md`); the schema
 * itself stays inside `libs/garage/database`.
 *
 * Everything database-related is run from the repo root:
 *
 *   npx prisma migrate dev --name <name>
 *   npx prisma migrate deploy
 *   npx prisma db seed
 *   npx prisma generate
 *
 * See `doc/database.md`.
 */

import 'dotenv/config';
import { join } from 'node:path';
import { defineConfig, env } from 'prisma/config';

const databaseLib = join(import.meta.dirname, 'libs', 'garage', 'database');

export default defineConfig({
  schema: join(databaseLib, 'prisma', 'schema.prisma'),
  migrations: {
    path: join(databaseLib, 'prisma', 'migrations'),
    // `prisma db seed` spawns this command; `dotenv/config` above has already
    // populated `process.env`, which the child process inherits.
    seed: 'node --require @swc-node/register libs/garage/database/src/scripts/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
