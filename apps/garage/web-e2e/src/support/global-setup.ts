/**
 * What has to be true of the database before the first browser opens.
 *
 * Two subprocesses, in order:
 *
 * 1. `prisma db seed` — idempotent upserts of the nine parking spots, the four
 *    development accounts and the reservation-window row. This is what makes
 *    `dev-admin` an admin: the role is a column, and no token can grant it.
 * 2. `libs/garage/database/src/scripts/reset-e2e.ts` — clears the target month and
 *    widens the reservation window. See that file for what it does and does not
 *    touch.
 *
 * ## Why subprocesses rather than imports
 *
 * `libs/garage/database` is `scope:api`; this app is `scope:web`. The module boundary
 * forbids the import and is right to — a test app is not a reason to let the
 * web scope reach the Prisma client. Running the scripts the same way a person
 * would keeps the boundary intact and keeps Prisma's connection pool out of the
 * Playwright process.
 *
 * `DATABASE_URL` is inherited: Nx injects the workspace-root `.env` into every
 * target's environment, and `nx run web-e2e:e2e` is what starts Playwright. A
 * missing value fails loudly here rather than as an unexplained empty screen
 * twenty seconds later.
 */

import { execFileSync } from 'node:child_process';
import { workspaceRoot } from '@nx/devkit';

/** `@swc-node/register` needs to be told where the `paths` live; see the script. */
const SWC_ENV = { ...process.env, SWC_NODE_PROJECT: 'tsconfig.base.json' };

export default function globalSetup(): void {
  if (!process.env['DATABASE_URL']) {
    throw new Error(
      'DATABASE_URL is not set. The e2e suite needs the dev database — start it with ' +
        '`docker compose --profile dev up -d` and copy `.env.example` to `.env` ' +
        '(see doc/testing.md).'
    );
  }

  run('npx', ['prisma', 'db', 'seed']);
  run('node', ['--require', '@swc-node/register', 'libs/garage/database/src/scripts/reset-e2e.ts']);
}

function run(command: string, args: readonly string[]): void {
  execFileSync(command, [...args], {
    cwd: workspaceRoot,
    env: SWC_ENV,
    stdio: 'inherit',
  });
}
