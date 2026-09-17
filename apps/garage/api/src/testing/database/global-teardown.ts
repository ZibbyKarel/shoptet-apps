/**
 * Jest `globalTeardown` for the `api:test-db` target: drops the run's database.
 *
 * Deliberately tolerant. A teardown that throws turns a failing test run into a
 * confusing one, and a database left behind is not a correctness problem —
 * `createTestDatabase` sweeps the prefix clean on the next run.
 */

import { ORIGINAL_DATABASE_URL, dropTestDatabase } from './test-database';

export default async function globalTeardown(): Promise<void> {
  const sourceUrl = process.env[ORIGINAL_DATABASE_URL];
  const testUrl = process.env['DATABASE_URL'];
  if (sourceUrl === undefined || testUrl === undefined) {
    return;
  }

  try {
    await dropTestDatabase(sourceUrl, testUrl);
  } catch {
    // Left for the next run's sweep. See the file comment.
  }
}
