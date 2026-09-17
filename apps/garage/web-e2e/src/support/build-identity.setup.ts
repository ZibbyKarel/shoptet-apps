/**
 * Proves that the app answering on `baseURL` is the build this run produced.
 *
 * ## Why a check and not a comment
 *
 * The suite used to leak its own `next start`: Playwright spawned
 * `npx nx run web:start`, Nx re-spawned the task **detached** into a process
 * group of its own, and Playwright's process-group kill never reached it. The
 * server survived the run with PPID 1, still holding 4200, and the next run —
 * `reuseExistingServer: !process.env['CI']`, with `CI` never set, because CI
 * ran no e2e job — adopted it. That run reported *20 passed* without executing
 * `web:build` at all, against the previous run's compiled output. A source
 * change made in between was invisible to it. Measured twice, same PID, in
 * `doc/decision/0285-*`.
 *
 * `playwright.config.mts` closes the two mechanisms: the server is started in
 * a group Playwright can kill, and `reuseExistingServer` is `false`. This file
 * closes the *claim* — it asserts the property those mechanisms are supposed
 * to produce, so that neither being quietly undone can pass unnoticed, and so
 * that a run pointed at some other server with `BASE_URL` is checked too.
 *
 * ## What is compared
 *
 * `next build` writes a fresh random id to `apps/garage/web/.next/BUILD_ID`, and a
 * running server stamps the id it holds into the flight payload of every
 * document it renders, as `"b":"<id>"`. This compares the two.
 *
 * **When the server latches that id was measured, not reasoned, and the answer
 * is neither of the two obvious ones.** It is not re-read per request, and it
 * is not read at boot either: it is read on the first render the process
 * serves, and cached from then on. Three servers, one workspace, ids A, B, C
 * (`doc/decision/0285-*`):
 *
 * - Server started on A, first request made only after a rebuild to B →
 *   reported **B**. Boot did not latch it.
 * - Same server, after a further rebuild to C that also changed a string on
 *   the sign-in page → still reported **B**, and served **B's markup**: the
 *   changed string was absent. A freshly started server on the same `.next`
 *   reported C and rendered the new string.
 * - Overwriting `.next/BUILD_ID` by hand under a server that had already
 *   served a request changed nothing it returned.
 *
 * So a server that has answered anything — which every adopted server has, it
 * spent the previous run answering that run's tests — is pinned to the build
 * that was on disk when it did, and it serves that build's compiled code. That
 * is the case this catches, and the second bullet is the proof that "stale id"
 * and "stale code" are the same fact rather than two hopeful ones.
 *
 * A failure here is not flakiness. It means the tests that follow would have
 * run against code that is not in this working tree.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';

/** What `nx run web:build` just wrote. `web-e2e:e2e` depends on that target. */
const BUILD_ID_FILE = join(workspaceRoot, 'apps', 'garage', 'web', '.next', 'BUILD_ID');

/**
 * `"b":"<build id>"` as it appears inside the flight payload — which is itself
 * a JSON string inside the document, so every quote arrives backslash-escaped.
 */
const SERVED_BUILD_ID = /\\"b\\":\\"([^"\\]+)\\"/u;

test('the app under test is the build this workspace just produced', async ({ request }) => {
  const built = (await readFile(BUILD_ID_FILE, 'utf8')).trim();
  expect(built, `${BUILD_ID_FILE} is empty — did web:build run?`).not.toBe('');

  // `/` redirects an anonymous visitor to the sign-in page; the request
  // context follows it. Asking for the root rather than a named route keeps
  // this check independent of any particular route's path, so it does not
  // need updating if one moves.
  const response = await request.get('/');
  expect(response.ok(), `GET / answered ${response.status()}`).toBe(true);

  const served = SERVED_BUILD_ID.exec(await response.text())?.[1];
  expect(
    served,
    'No build id in the served document. Next.js stamps `"b":"<id>"` into the ' +
      'flight payload of every rendered page; if that stopped being true this ' +
      'check has to be rewritten, not deleted — see the header of this file.'
  ).toBeDefined();

  expect(
    served,
    'The server answering on the base URL is running a different build than ' +
      'the one in this working tree. Something else is holding port 4200 — ' +
      'a leftover `next start`, or a `nx run web:dev`. Free it and run again; ' +
      'every result from this run would have been about the wrong code.'
  ).toBe(built);
});
