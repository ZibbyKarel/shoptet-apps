/**
 * What the ICS feed writes to the log — read off a real pino destination.
 *
 * ## Why this spec exists at all
 *
 * The feed's credential is in its URL, and a URL is the one thing every HTTP
 * logger writes by default. Before this spec, a successful request logged the
 * token **three times** at `level: info` — `req.url` and `req.params` from
 * `nestjs-pino`'s per-request line, and `path` again from
 * `ContractExceptionFilter` on the 404 — while `doc/ics.md` §7 said "the app
 * never logs it". Nothing caught it because every other spec in this workspace
 * pins `LOG_LEVEL: 'fatal'` and none of them attaches a destination, so no test
 * had ever read a log line.
 *
 * So this one boots the **assembled application at `LOG_LEVEL: 'info'`** with
 * the real `buildLoggerOptions` output pointed at an in-memory stream, sends
 * real requests, and asserts on the bytes pino actually emitted. Asserting on
 * the redaction helper alone would not have caught the original defect: the
 * helper did not exist, and the leak was in serializer output nobody had looked
 * at.
 *
 * ## What is asserted
 *
 * For every arm — a valid token, an unknown one, and a malformed path — the
 * token must appear in **no** emitted line, and each of the four sites it used
 * to reach is pinned individually, so that a partial regression fails with the
 * name of the site that broke rather than one opaque "token found".
 */

import { ICS_FEED_BASE_PATH, buildIcsFeedPath } from '@garage/contract';
import type { OidcTestIssuer, TestSigningKey } from '../auth/testing/oidc-test-issuer';
import { createSigningKey, startOidcTestIssuer } from '../auth/testing/oidc-test-issuer';
import { PrismaDouble } from '../testing/prisma-double';
import type { ApiTestApp } from '../testing/nest-test-app';
import { startApiTestApp } from '../testing/nest-test-app';
import { REDACTED_ICS_TOKEN } from '../logging/redact-ics-token';

/** Shaped like the real thing: 32 bytes of `randomBytes`, base64url. */
const VALID_TOKEN = 'aG93ZXZlci1sb25nLXRoaXMtaXMtaXQtaXMtb3BhcXVl';
const UNKNOWN_TOKEN = 'bm90LWEtdG9rZW4tYnV0LXRoZS1zYW1lLXNoYXBlLXh4';

/** The URL every arm below should produce in the log, and the only one. */
const REDACTED_FEED_URL = `${ICS_FEED_BASE_PATH}/${REDACTED_ICS_TOKEN}`;

/** One emitted log line, parsed. Fields are read defensively — this is JSON. */
interface LogLine {
  level?: string;
  message?: string;
  req?: { url?: string; params?: unknown };
  path?: unknown;
  reason?: unknown;
  [key: string]: unknown;
}

/**
 * The whole file's deadline, and the only one.
 *
 * This spec used to poll for the request line against a **2 s wall clock of its
 * own**, below jest's 5 s default, which made it the tightest deadline in the
 * suite and a function of machine load rather than of the code it guards. That
 * matters more here than in an ordinary spec: this file exists because an ICS
 * bearer token was once logged in four places, and a security spec that reddens
 * on a busy CI box gets its number bumped or gets quarantined — and then nobody
 * looks the time it goes red for a real reason. The api suite grew from 38 to
 * 49 suites when Task 16 merged, so the trend is one-directional.
 *
 * The wait below is now **event-driven** — the capture stream resolves it the
 * instant a matching line is written — so no polling interval and no starved
 * worker can miss it. This budget is only a backstop that keeps the diagnostic
 * ("no request line was emitted … got: …") readable instead of jest's generic
 * timeout, and it is derived from the file's timeout rather than being an
 * unrelated constant.
 *
 * ## Why the budget is not simply large
 *
 * A generous per-test budget makes the *failure* path unbearable: with a 25 s
 * budget, a fully broken destination took **229 s** to report, against ~18 s
 * before, because all nine tests wait out the full budget in turn. A test
 * suite nobody will sit through is its own kind of unreliable.
 *
 * So the budget stays generous per test — a starved worker gets 10 s, five
 * times the deadline that was failing — and {@link destinationBroken}
 * short-circuits the *rest* of the file once one wait has actually timed out.
 * Nothing here is per-test state: a wait that times out means the log
 * destination produced nothing at all, which is a property of the whole
 * fixture. The broken path now reports in ~10 s, better than the 18 s it cost
 * before this file was touched, and the first failure still carries the full
 * diagnostic. The trade is that a *transient* timeout in one test also
 * short-circuits its successors; they say so in their own message rather than
 * pretending to be independent failures.
 */
const TEST_TIMEOUT_MS = 15_000;
const WAIT_BUDGET_MS = 10_000;

jest.setTimeout(TEST_TIMEOUT_MS);

describe('the ICS feed and the log', () => {
  let harness: ApiTestApp;
  let issuer: OidcTestIssuer;
  let signingKey: TestSigningKey;
  let double: PrismaDouble;
  let emitted: string[] = [];
  /** Waiters registered by {@link waitForEmitted}, resolved from the stream. */
  let waiters: { matches: (all: string) => boolean; resolve: () => void }[] = [];
  /**
   * Set once any wait times out. Deliberately **not** reset per test: it
   * records that the log destination as a whole produced nothing, which is
   * what makes short-circuiting the remaining tests correct rather than merely
   * fast. See the file comment.
   */
  let destinationBroken: string | undefined;

  const originalEnv = { ...process.env };

  beforeAll(async () => {
    signingKey = createSigningKey('key-1');
    issuer = await startOidcTestIssuer([signingKey]);
    double = new PrismaDouble();

    harness = await startApiTestApp({
      issuer,
      store: double,
      // The point of the spec. Every other spec pins `fatal`, which is exactly
      // why the leak survived: at `fatal` the request line is never emitted.
      // The harness builds the *real* `buildLoggerOptions` at this level and
      // attaches the destination below — nothing about the redaction is
      // configured here, because if it were, this spec would be testing its own
      // setup.
      logLevel: 'info',
      onLogLine: (line) => {
        emitted.push(line);
        // Push, rather than let a poller pull: this is what makes the wait
        // independent of how busy the machine is.
        const all = emitted.join('');
        for (const waiter of [...waiters]) {
          if (waiter.matches(all)) {
            waiters = waiters.filter((pending) => pending !== waiter);
            waiter.resolve();
          }
        }
      },
    });
  });

  afterAll(async () => {
    await harness?.close();
    await issuer?.close();
    process.env = originalEnv;
  });

  beforeEach(() => {
    double.reset();
    emitted = [];
    waiters = [];
  });

  /**
   * Resolves as soon as the captured output satisfies `matches`.
   *
   * Event-driven: the capture stream resolves this from `_write`, so a busy
   * machine delays it by exactly as long as it delays the write itself. The
   * budget exists only so a genuine failure reports what *was* emitted instead
   * of jest's generic timeout — see {@link WAIT_BUDGET_MS}.
   */
  async function waitForEmitted(matches: (all: string) => boolean, what: string): Promise<void> {
    if (matches(emitted.join(''))) {
      return;
    }
    if (destinationBroken !== undefined) {
      // An earlier wait already proved the destination emits nothing. Waiting
      // out the full budget again would add ten seconds per remaining test to
      // a run that is already red — see the file comment.
      throw new Error(`${what}; skipped the wait — ${destinationBroken}`);
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const waiter = { matches, resolve };
        waiters.push(waiter);
        timer = setTimeout(() => {
          waiters = waiters.filter((pending) => pending !== waiter);
          destinationBroken = `an earlier test in this file waited ${WAIT_BUDGET_MS}ms for log output and got none`;
          reject(new Error(`${what}; got: ${emitted.join('')}`));
        }, WAIT_BUDGET_MS);
      });
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Sends `path` and returns every log line the request produced.
   *
   * The per-request line is written when the response emits `finish`, which can
   * be a tick or two after `fetch` resolves, so this waits for it by name
   * rather than sleeping for a guessed interval.
   */
  async function getAndCollectLogs(path: string): Promise<{ status: number; lines: LogLine[] }> {
    const response = await fetch(`${harness.baseUrl}${path}`);
    await response.text();

    await waitForEmitted(
      (all) => all.includes('"request completed"'),
      `no request line was emitted for ${path}`
    );

    const lines = emitted
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LogLine);
    return { status: response.status, lines };
  }

  function requestLine(lines: LogLine[]): LogLine {
    const line = lines.find((candidate) => candidate.message === 'request completed');
    expect(line).toBeDefined();
    return line as LogLine;
  }

  function rejectionLine(lines: LogLine[]): LogLine {
    const line = lines.find((candidate) => candidate.message === 'Request rejected');
    expect(line).toBeDefined();
    return line as LogLine;
  }

  function seedHolderWithOneReservation(): void {
    const spot = double.seedSpot({ label: 'E2.92' });
    const user = double.seedUser({ oktaId: 'okta-holder', icsToken: VALID_TOKEN });
    double.seedReservation({
      parkingSpotId: spot.id,
      userId: user.id,
      date: `${new Date().getUTCFullYear() + 1}-06-01`,
      createdAt: new Date('2026-09-01T08:30:00.000Z'),
    });
  }

  describe('a request that succeeds', () => {
    it('emits the request line at info, and it does not contain the token', async () => {
      seedHolderWithOneReservation();

      const { status, lines } = await getAndCollectLogs(buildIcsFeedPath(VALID_TOKEN));

      expect(status).toBe(200);
      // The line really was emitted at `info`: without this, a regression that
      // silenced logging entirely would pass every assertion below.
      expect(requestLine(lines).level).toBe('info');
      expect(lines).not.toHaveLength(0);
      for (const line of lines) {
        expect(JSON.stringify(line)).not.toContain(VALID_TOKEN);
      }
    });

    it('logs the redacted URL in req.url', async () => {
      seedHolderWithOneReservation();

      const { lines } = await getAndCollectLogs(buildIcsFeedPath(VALID_TOKEN));

      expect(requestLine(lines).req?.url).toBe(REDACTED_FEED_URL);
    });

    it('does not log req.params, the second copy of the same URL', async () => {
      seedHolderWithOneReservation();

      const { lines } = await getAndCollectLogs(buildIcsFeedPath(VALID_TOKEN));

      // Not "params does not contain the token" — the key is gone. What lands
      // there is the logging middleware's own catch-all splat, which is the URL
      // again in a shape no redaction of `url` would ever reach.
      expect(requestLine(lines).req).not.toHaveProperty('params');
    });
  });

  describe('a request with an unknown token', () => {
    it('leaks it in no line, including the filter’s rejection line', async () => {
      const { status, lines } = await getAndCollectLogs(buildIcsFeedPath(UNKNOWN_TOKEN));

      expect(status).toBe(404);
      // Two lines here, not one: the filter's own `warn` plus the request line.
      // The filter's was the third copy of the token.
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const line of lines) {
        expect(JSON.stringify(line)).not.toContain(UNKNOWN_TOKEN);
      }
    });

    it('redacts the path in the filter’s rejection line', async () => {
      const { lines } = await getAndCollectLogs(buildIcsFeedPath(UNKNOWN_TOKEN));

      const rejection = rejectionLine(lines);
      expect(rejection.level).toBe('warn');
      expect(rejection.path).toBe(REDACTED_FEED_URL);
      // The 404 branch still logs without `err` — a stack per unrouted probe is
      // noise, and this is a route an anonymous caller can hit at will.
      expect(rejection).not.toHaveProperty('err');
    });

    it('redacts the URL in the request line too', async () => {
      const { lines } = await getAndCollectLogs(buildIcsFeedPath(UNKNOWN_TOKEN));

      expect(requestLine(lines).req?.url).toBe(REDACTED_FEED_URL);
      expect(requestLine(lines).req).not.toHaveProperty('params');
    });
  });

  describe('a malformed request, one character away from a real token', () => {
    it('leaks nothing, including through Nest’s own “Cannot GET …” message', async () => {
      // No `.ics`, so this matches no route and Nest builds the 404 itself —
      // with the full URL in the exception message, which the filter logs as
      // `reason`. The fourth site, and the one a redaction of `path` alone
      // would have missed.
      const { status, lines } = await getAndCollectLogs(`${ICS_FEED_BASE_PATH}/${UNKNOWN_TOKEN}`);

      expect(status).toBe(404);
      for (const line of lines) {
        expect(JSON.stringify(line)).not.toContain(UNKNOWN_TOKEN);
      }
      expect(rejectionLine(lines).reason).toBe(`Cannot GET ${REDACTED_FEED_URL}`);
    });
  });

  describe('a request whose path differs only in case', () => {
    it('is redacted as well, because Express’s router is case-insensitive', async () => {
      seedHolderWithOneReservation();

      // Express matches this to the same handler (`caseSensitive` defaults to
      // false), so a case-sensitive redaction would be a one-character bypass
      // of the whole thing.
      const { lines } = await getAndCollectLogs(`/API/Calendar/${VALID_TOKEN}.ics`);

      for (const line of lines) {
        expect(JSON.stringify(line)).not.toContain(VALID_TOKEN);
      }
    });
  });

  describe('every other route', () => {
    it('still has its full URL in the log', async () => {
      // The redaction is scoped to the feed, not a blanket "drop the URL": a
      // log that cannot say what was requested is worth very little, and this
      // is what stops the fix from quietly becoming that.
      const { lines } = await getAndCollectLogs('/api/no-such-route');

      expect(requestLine(lines).req?.url).toBe('/api/no-such-route');
      expect(rejectionLine(lines).path).toBe('/api/no-such-route');
    });
  });
});
