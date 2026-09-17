/**
 * The single place where a `PrismaClient` is constructed.
 *
 * Prisma 7 requires a driver adapter for every SQL provider — the Rust query
 * engine is gone — so a bare `new PrismaClient()` no longer connects to
 * anything. Keeping the adapter wiring here means Task 10's `PrismaService`
 * (and any script) gets a correctly configured client from one function instead
 * of repeating the adapter setup.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export interface CreatePrismaClientOptions {
  /**
   * Postgres connection string, normally `DATABASE_URL`. Passed in rather than
   * read from `process.env` here: `apps/garage/api` validates its environment with Zod
   * at startup (`apps/garage/api/src/env.ts`) and this lib must not grow a second,
   * unvalidated way to reach configuration.
   */
  connectionString: string;
}

/**
 * Builds a `PrismaClient` bound to a `pg` connection pool.
 *
 * The caller owns the lifetime: call `$disconnect()` when shutting down, which
 * is what the Nest module in Task 10 hooks into `onModuleDestroy`.
 */
export function createPrismaClient({ connectionString }: CreatePrismaClientOptions): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
