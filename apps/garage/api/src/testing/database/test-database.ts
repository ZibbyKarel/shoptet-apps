/**
 * The throwaway database the `*.db.spec.ts` suite runs against.
 *
 * ## Why a whole database rather than a rollback
 *
 * Task 12's `database-contract.db.spec.ts` leaves nothing behind by running
 * every case inside a transaction it always rolls back. Task 13 cannot do that
 * for its concurrency tests, and the reason is the point of those tests:
 * **two transactions racing must actually commit**, or there is no race — an
 * uncommitted row is invisible to the other connection, so a "concurrency test"
 * built on rollbacks would test nothing at all.
 *
 * Committing means residue, and the residue cannot be cleaned up: promotion
 * writes an `AuditLog` row, `AuditLog` rejects `DELETE` by trigger
 * (`doc/decision/0027-*`), and the fixture users those rows point at are then
 * pinned by `ON DELETE RESTRICT`. There is no order of deletions that empties
 * the tables again. So the suite gets its own database, created before the run
 * and dropped after it, and the developer's seeded `garage` is never written
 * to at all.
 *
 * ## Why the migrations are applied as SQL rather than by `prisma migrate deploy`
 *
 * `migrate deploy` applies a migration directory as a single unit and records it
 * in `_prisma_migrations`. Applying the same files in the same order does the
 * same thing to the schema, which is all a throwaway database needs, without
 * spawning a CLI inside `globalSetup` or depending on `prisma.config.ts`
 * resolving from Jest's working directory. Crucially it is not a *fixture*: the
 * files read here are the real, committed migrations, so a schema change that
 * would break production breaks this suite too.
 *
 * ## Leaked databases heal themselves — but only the actually-dead ones
 *
 * A Jest run killed between setup and teardown leaves its database behind.
 * {@link createTestDatabase} therefore drops leftovers matching the prefix
 * before creating its own, so the next run cleans up after the last one — but
 * only databases old enough that no real run could still be using them
 * ({@link isStaleTestDatabase}). Two `api:test-db` runs started around the same
 * time must not be able to drop each other's still-in-progress database
 * (`doc/decision/0066-*` §Risk).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Every database this suite has ever created starts with this. The prefix is
 * what makes the self-healing sweep safe: nothing else may be named this way,
 * and in particular the developer's `garage` is not.
 */
export const TEST_DATABASE_PREFIX = 'garage_dbspec_';

/** Env var carrying the URL of the developer's own database, for teardown. */
export const ORIGINAL_DATABASE_URL = 'GARAGE_ORIGINAL_DATABASE_URL';

/** The repo root — five directories up from `apps/garage/api/src/testing/database`. */
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');
const MIGRATIONS_DIR = join(WORKSPACE_ROOT, 'libs', 'garage', 'database', 'prisma', 'migrations');

/**
 * The connection string, or a hard failure.
 *
 * The suite **does not skip** when the database is absent — that is the whole
 * point of it being a separate target. A green run against no database is worse
 * than no run at all, because it looks like evidence.
 */
export function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set. This suite needs a real PostgreSQL — start it with ' +
        '`docker compose --profile dev up -d` and run `nx run api:test-db`. It does not ' +
        'skip itself, on purpose.'
    );
  }
  return url;
}

/**
 * A value nothing else in the database can collide with.
 *
 * The random segment is not decoration. Jest gives each spec file its own module
 * registry, so a counter alone restarts at zero per file while `process.pid`
 * stays the same — and the suites share one database, so the second file's
 * fixtures collided with the first's on `User_email_key`.
 *
 * It lives here, beside {@link requireDatabaseUrl}, rather than in
 * `reservation-harness.ts`, because every `*.db.spec.ts` already imports this
 * module for the connection string: a spec that needs a unique fixture value
 * finds this one before it is tempted to re-type a pid-and-counter version.
 * `calendar.db.spec.ts` did exactly that.
 */
const RUN_ID = randomUUID().slice(0, 8);
let uniqueCounter = 0;
export function unique(prefix: string): string {
  uniqueCounter += 1;
  return `${prefix}-${RUN_ID}-${uniqueCounter}`;
}

/** The same URL, pointing at a different database on the same server. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * A unique name for this run.
 *
 * The pid alone is not unique enough — pids are recycled — so a timestamp goes
 * in too. Lower case and underscores only, because the name is interpolated
 * into `CREATE DATABASE`, and {@link assertSafeIdentifier} refuses anything else.
 */
export function testDatabaseName(): string {
  return `${TEST_DATABASE_PREFIX}${process.pid}_${Date.now()}`;
}

/**
 * Refuses a name that is not a plain lower-case identifier.
 *
 * These names are generated, not user input, so this is not a sanitiser — it is
 * the assertion that keeps it that way. `DROP DATABASE` takes no parameters, so
 * the identifier really is interpolated, and a future change that made the name
 * configurable would fail here rather than quietly become an injection.
 */
function assertSafeIdentifier(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to interpolate an unsafe database identifier: ${name}`);
  }
}

/**
 * Runs `work` against the server's `postgres` database.
 *
 * `CREATE DATABASE` and `DROP DATABASE` cannot run from inside the database
 * they name, and neither can run in a transaction — which is why this is a raw
 * `pg` client rather than a Prisma one.
 */
async function withMaintenanceClient<T>(
  url: string,
  work: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: withDatabase(url, 'postgres') });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * No real `api:test-db` run takes anywhere near this long. Anything named by
 * {@link testDatabaseName} older than this cannot belong to a run that is
 * still going — only to one that crashed without reaching `globalTeardown`.
 */
const STALE_TEST_DATABASE_MS = 60 * 60 * 1000; // 1 hour.

/** Matches a name {@link testDatabaseName} could have produced, capturing the timestamp. */
const TEST_DATABASE_NAME_PATTERN = new RegExp(`^${TEST_DATABASE_PREFIX}\\d+_(\\d+)$`);

/**
 * True only for a database old enough that no concurrent, still-running suite
 * could own it — so it is safe to force-drop as a leak from a crashed run.
 *
 * This is a name-and-age check rather than "does anything look connected to
 * it", because a crashed process's connections can linger in `pg_stat_activity`
 * past the process's own death until TCP keepalive notices — checking
 * liveness that way would let a genuinely leaked database dodge cleanup, not
 * protect a concurrent one.
 */
function isStaleTestDatabase(datname: string): boolean {
  const match = TEST_DATABASE_NAME_PATTERN.exec(datname);
  if (match?.[1] === undefined) {
    return false; // Not a name this suite generates — leave it alone either way.
  }
  const createdAt = Number(match[1]);
  return Date.now() - createdAt > STALE_TEST_DATABASE_MS;
}

/** Drops leftovers from a previous, interrupted run — never a concurrent one still in progress. */
async function dropStaleDatabases(client: Client): Promise<void> {
  const { rows } = await client.query<{ datname: string }>(
    'SELECT datname FROM pg_database WHERE datname LIKE $1',
    [`${TEST_DATABASE_PREFIX}%`]
  );
  for (const { datname } of rows) {
    if (!isStaleTestDatabase(datname)) {
      continue; // Could be a concurrent run's database; only age proves it is not.
    }
    assertSafeIdentifier(datname);
    // `WITH (FORCE)` (PostgreSQL 13+) terminates connections a crashed run left
    // open, which would otherwise make the drop fail and the leak permanent.
    await client.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
  }
}

/** Every committed migration, in the order `migrate deploy` would apply them. */
function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
}

/**
 * Creates the run's database and applies the schema to it.
 *
 * @returns the connection string of the new database
 */
export async function createTestDatabase(sourceUrl: string): Promise<string> {
  const name = testDatabaseName();
  assertSafeIdentifier(name);

  await withMaintenanceClient(sourceUrl, async (client) => {
    await dropStaleDatabases(client);
    await client.query(`CREATE DATABASE "${name}"`);
  });

  const url = withDatabase(sourceUrl, name);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const sql of migrationStatements()) {
      await client.query(sql);
    }
  } finally {
    await client.end();
  }

  return url;
}

/** Drops the run's database. Safe to call when it is already gone. */
export async function dropTestDatabase(sourceUrl: string, url: string): Promise<void> {
  const name = new URL(url).pathname.replace(/^\//, '');
  assertSafeIdentifier(name);
  await withMaintenanceClient(sourceUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}
