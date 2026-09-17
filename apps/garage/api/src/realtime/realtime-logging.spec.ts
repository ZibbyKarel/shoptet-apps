/**
 * What a refused handshake writes to the log.
 *
 * Its own file, not a second `describe` in `realtime-handshake.spec.ts`, for a
 * mechanical reason: `LOG_LEVEL` and the pino destination have to be in place
 * before `AppModule` is imported, and Jest gives each **file** a fresh module
 * registry. Reaching for `jest.resetModules()` inside one file instead
 * re-evaluates `AppModule` while the harness still holds the *previous*
 * `PrismaService` class, so `.overrideProvider(PrismaService)` silently matches
 * nothing and the app opens a real database connection. That was observed, not
 * feared.
 *
 * ## Why the log is read at all
 *
 * A handshake token is a bearer credential arriving on a path the client
 * *retries* at 1 s / 5 s / 30 s, so one leaked line becomes several. A sibling
 * task shipped exactly this defect in four places and it survived review
 * because every spec in this workspace pins `LOG_LEVEL: 'fatal'` and none of
 * them attaches a destination — so no test had ever read a log line. This one
 * boots the assembled application at `debug`, points the real
 * `buildLoggerOptions` output at an in-memory stream, and asserts on the bytes
 * pino actually emitted.
 */

import { RealtimeTestClient } from './testing/realtime-test-client';
import type { RealtimeTestApp } from './testing/realtime-test-app';
import { seedEmployee, startRealtimeTestApp } from './testing/realtime-test-app';

/**
 * The file's deadline, and the only one — see the matching comment in
 * `calendar/calendar-logging.spec.ts`. The wait below is event-driven (the
 * harness's `onLogLine` resolves it), so this budget is a backstop that keeps
 * the diagnostic readable, not the mechanism. It replaced a 2 s poll loop that
 * was tighter than jest's own default and got tighter in effect every time the
 * api suite grew.
 *
 * The budget is generous per test but does not compound across the file: once
 * one wait has timed out, `destinationBroken` short-circuits the rest, because
 * a wait that times out means the destination emitted nothing at all — a
 * property of the fixture, not of one test. Without that, a broken file costs
 * the budget times the test count; `calendar-logging.spec.ts`'s file comment
 * has the measurement that prompted it.
 */
const TEST_TIMEOUT_MS = 15_000;
const WAIT_BUDGET_MS = 10_000;

jest.setTimeout(TEST_TIMEOUT_MS);

describe('what a refused handshake writes to the log', () => {
  let harness: RealtimeTestApp;
  let emitted: string[] = [];
  /** Waiters registered by {@link waitForEmitted}, resolved from `onLogLine`. */
  let waiters: { matches: (all: string) => boolean; resolve: () => void }[] = [];
  /** Set once any wait times out; never reset per test. See the file comment. */
  let destinationBroken: string | undefined;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    harness = await startRealtimeTestApp({
      // Not `fatal`. A spec that would pass only because nothing was emitted is
      // not a passing spec.
      logLevel: 'debug',
      onLogLine: (line) => {
        emitted.push(line);
        // Push, rather than let a poller pull: what makes the wait below
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
    seedEmployee(harness.double, { oktaId: 'okta-alice', name: 'Alice' });
  });

  afterAll(async () => {
    await harness?.close();
    process.env = originalEnv;
  });

  beforeEach(() => {
    emitted = [];
    waiters = [];
  });

  /** Resolves as soon as the captured output satisfies `matches`. */
  async function waitForEmitted(matches: (all: string) => boolean, what: string): Promise<void> {
    if (matches(emitted.join(''))) {
      return;
    }
    if (destinationBroken !== undefined) {
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

  /** Waits for the gateway's own line, so the assertion never races the logger. */
  async function refuseAndCollectLogs(token: string | undefined): Promise<string[]> {
    const client = await RealtimeTestClient.connect({ baseUrl: harness.baseUrl, token });
    expect(client.isConnected).toBe(false);
    await client.disconnect();

    await waitForEmitted(
      (all) => all.includes('Refused a Socket.io handshake'),
      'no refusal line was emitted'
    );
    return emitted
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0);
  }

  it('emits a line at all — the control for every assertion below', async () => {
    const lines = await refuseAndCollectLogs('garbage');

    const refusal = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(refusal.some((line) => line['message'] === 'Refused a Socket.io handshake')).toBe(true);
  });

  it('does not contain the rejected token', async () => {
    // The hazard this whole describe block exists for: a handshake token is a
    // bearer credential arriving on a path that is *retried* by the client at
    // 1s / 5s / 30s, so one leaked line becomes several.
    const token = harness.tokenFor({ subject: 'okta-alice', expiresInSeconds: -60 });

    const lines = await refuseAndCollectLogs(token);

    for (const line of lines) {
      expect(line).not.toContain(token);
      // Not just the whole token: a JWT's three parts are individually usable
      // for correlation, and the signature is the part a leak would be worst.
      for (const part of token.split('.')) {
        expect(line).not.toContain(part);
      }
    }
  });

  it('carries a reason and no stack for a token the API was never going to accept', async () => {
    const lines = await refuseAndCollectLogs('garbage');

    const refusal = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line['message'] === 'Refused a Socket.io handshake');

    expect(refusal?.['reason']).toBe('token-rejected');
    // No `err`. Forwarding a stack for something an anonymous caller can
    // trigger at will is a log-flood vector — the same call
    // `ContractExceptionFilter` makes for a pre-routing client error.
    expect(refusal).not.toHaveProperty('err');
    expect(refusal?.['level']).toBe('debug');
  });

  it('distinguishes a missing token from a rejected one, for the operator only', async () => {
    const lines = await refuseAndCollectLogs(undefined);

    const refusal = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line['message'] === 'Refused a Socket.io handshake');

    expect(refusal?.['reason']).toBe('no-token');
  });

  it('keeps the stack for a deactivated user, whose refusal is a DomainError', async () => {
    // The asymmetry `ContractExceptionFilter` draws over HTTP, mirrored here:
    // only a caller with a *valid* token reaches this, so it cannot be used to
    // flood the log, and the frames name the rule that refused.
    const gone = seedEmployee(harness.double, { oktaId: 'okta-gone', name: 'Former Employee' });
    const row = harness.double.users.find((user) => user.id === gone.id);
    if (row !== undefined) {
      row.active = false;
    }

    const lines = await refuseAndCollectLogs(harness.tokenFor({ subject: 'okta-gone' }));

    const refusal = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line['message'] === 'Refused a Socket.io handshake');

    expect(refusal?.['reason']).toBe('user-deactivated');
    expect(refusal?.['level']).toBe('warn');
    expect(refusal).toHaveProperty('err');
  });
});
