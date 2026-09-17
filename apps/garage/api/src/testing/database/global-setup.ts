/**
 * Jest `globalSetup` for the `api:test-db` target.
 *
 * Creates the run's throwaway database, applies the committed migrations to it,
 * and repoints `DATABASE_URL` at it. Jest runs this in the main process before
 * any worker starts, so the environment it leaves behind is the one every spec
 * sees — including Task 12's `database-contract.db.spec.ts`, which reads
 * `DATABASE_URL` itself and is now isolated from the developer's data too.
 *
 * If `DATABASE_URL` is absent this **throws**, and the run exits non-zero. See
 * `test-database.ts` for why not skipping is the whole point.
 */

import { ORIGINAL_DATABASE_URL, createTestDatabase, requireDatabaseUrl } from './test-database';

export default async function globalSetup(): Promise<void> {
  const sourceUrl = requireDatabaseUrl();
  const testUrl = await createTestDatabase(sourceUrl);

  process.env[ORIGINAL_DATABASE_URL] = sourceUrl;
  process.env['DATABASE_URL'] = testUrl;
}
