/**
 * **The whole API** authenticates with the same code in every environment.
 *
 * `apps/garage/api/src/auth`'s rule — "dev, e2e and production all run this exact same
 * validation; only the values differ" — is the claim, and this spec is what
 * stops it becoming a comment. A configurable module is exactly where an
 * `if (isTest)` grows: the distinction drawn here is that a **value** may differ
 * between environments and a **branch** may not.
 *
 * The scan used to cover `apps/garage/api/src/realtime` and nothing else — five files
 * in one directory, because `readdirSync` is not recursive — while quoting a
 * rule taken from `apps/garage/api/src/auth`, which is where an `if (isTest)` would
 * actually let an unauthenticated caller in and which was guarded nowhere. It
 * now walks all of `apps/garage/api/src`. The file keeps its name because four places
 * in the codebase and the docs cite it by that name; the `describe` titles below
 * say what it actually covers. See `doc/decision/0238-*`.
 *
 * Source is read from disk rather than asserted behaviourally because the claim
 * is about what is *not* there. A behavioural test can only probe the branches
 * somebody thought of.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** `apps/garage/api/src` — this file lives one level under it. */
const SRC_DIR = join(__dirname, '..');
const REALTIME_DIR = join(__dirname);

/**
 * How few shipped files would mean the walker has stopped finding anything.
 *
 * The vacuity guard, and the reason it is a count rather than a file list: the
 * list this spec used to pin broke on any new file in one directory, which is
 * an invitation to relax the assertion. What actually has to be impossible is a
 * walker that matches nothing and passes every `not.toContain` for free.
 * Measured at 85 files at the time of writing.
 */
const MIN_SHIPPED_FILES = 60;

/**
 * Files that name `NODE_ENV` in shipped code, and may.
 *
 * All three only ever *carry* the value — a Zod schema member, a DI read that
 * hands it to the logger factory, and the `base` field of a log record. None of
 * them branches on it, which is asserted separately below rather than assumed.
 */
const ENV_NAME_CARRIERS = ['app/app.module.ts', 'env.ts', 'logging/logger.options.ts'];

/** A `NODE_ENV` occurrence that is a decision rather than a value being passed. */
const BRANCHES_ON_ENV =
  /NODE_ENV['"\]\s]*(?:[=!]==?|\?|&&|\|\|)|[=!]==?\s*['"](?:test|development)/;

/**
 * Comments removed, so the scan reads *code*.
 *
 * Without this the suite would fail on a comment that says "there is no
 * `NODE_ENV` branch here" — which is the opposite of the property it is
 * checking, and would push the next author to delete the explanation rather
 * than keep the guarantee.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Everything the application ships, recursively — specs and their support
 * excluded.
 *
 * `testing/` directories are skipped rather than filtered by name because that
 * is exactly where a double *should* be allowed to say `isTest`, and
 * `tsconfig.app.json` already keeps them out of the build.
 */
function shippedSources(dir = SRC_DIR): { name: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'testing' ? [] : shippedSources(path);
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
      return [];
    }
    return [
      {
        name: relative(SRC_DIR, path).split(sep).join('/'),
        source: withoutComments(readFileSync(path, 'utf8')),
      },
    ];
  });
}

/** The realtime module's own files, for the assertions specific to it. */
function realtimeSources(): { name: string; source: string }[] {
  return shippedSources(REALTIME_DIR);
}

describe('the API has no environment-dependent behaviour', () => {
  it('walks a whole source tree, not an empty directory', () => {
    // Without this the suite passes vacuously the day the walker stops
    // matching — every `not.toContain` below is true of nothing.
    const files = shippedSources();
    expect(files.length).toBeGreaterThanOrEqual(MIN_SHIPPED_FILES);
    // And it really reaches the two directories the rule is about.
    const names = files.map((file) => file.name);
    expect(names).toContain('auth/jwks-verifier.service.ts');
    expect(names).toContain('realtime/realtime.gateway.ts');
  });

  it.each(['JEST_WORKER_ID', 'isTest', 'isDev', 'skipAuth', 'bypass'])(
    'never mentions %s anywhere in apps/garage/api/src',
    (needle) => {
      for (const file of shippedSources()) {
        expect(`${file.name}: ${file.source}`).not.toContain(needle);
      }
    }
  );

  it('never reads a CI flag', () => {
    // As a whole word, not a substring: `toContain('CI')` was true of the five
    // realtime files by luck, and across 85 it would be a coin toss on some
    // future identifier rather than a check.
    for (const file of shippedSources()) {
      expect(`${file.name}: ${file.source}`).not.toMatch(/\bCI\b/);
    }
  });

  it('names NODE_ENV only in the three files that carry it, and never to branch', () => {
    const mentions = shippedSources().filter((file) => file.source.includes('NODE_ENV'));

    expect(mentions.map((file) => file.name).sort()).toEqual(ENV_NAME_CARRIERS);
    for (const file of mentions) {
      // Carrying the value is fine; deciding on it is the backdoor.
      expect(`${file.name}: ${file.source}`).not.toMatch(BRANCHES_ON_ENV);
    }
  });
});

describe('the realtime module', () => {
  it('ships the files this spec thinks it does', () => {
    expect(
      realtimeSources()
        .map((file) => file.name)
        .sort()
    ).toEqual([
      'realtime/lock.service.ts',
      'realtime/realtime-handshake.ts',
      'realtime/realtime-io.adapter.ts',
      'realtime/realtime.gateway.ts',
      'realtime/realtime.module.ts',
      'realtime/realtime.publisher.ts',
    ]);
  });

  it('reads exactly one environment key, and it is a duration', () => {
    const configReads = realtimeSources()
      .flatMap((file) => [...file.source.matchAll(/configService\.get\('([A-Z_]+)'/g)])
      .map((match) => match[1]);

    expect(configReads).toEqual(['REALTIME_LOCK_TTL_MS']);
  });

  it('verifies tokens through the shared JwksVerifierService, not a second jwks client', () => {
    // `doc/decision/0042-*`: two `JwksClient`s would mean two key caches, two
    // rate limiters and two rotation moments, so a rotated key could be live
    // over HTTP and not yet over WebSocket. Checked across the whole tree, not
    // just this module: a second client anywhere would have the same effect.
    for (const file of shippedSources()) {
      if (file.name === 'auth/jwks-verifier.service.ts') {
        continue;
      }
      expect(`${file.name}: ${file.source}`).not.toContain('jwks-rsa');
      expect(`${file.name}: ${file.source}`).not.toContain('JwksClient');
    }
    const handshake = realtimeSources().find(
      (file) => file.name === 'realtime/realtime-handshake.ts'
    );
    expect(handshake?.source).toContain('this.verifier.verifyToken(');
  });
});
