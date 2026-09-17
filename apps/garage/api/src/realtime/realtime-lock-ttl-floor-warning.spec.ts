/**
 * `RealtimeGateway.onModuleInit` warns when `REALTIME_LOCK_TTL_MS` is
 * configured below the documented floor.
 *
 * Task 15's review, Finding 7: the TTL has a documented floor
 * (`doc/decision/0110-*`) below which the client's renewal budget stops
 * having margin, but nothing enforced or even flagged it. A schema `.min()`
 * was rejected in fix round 1 — it would break the short TTLs every other
 * realtime spec in this workspace deliberately runs at — so the fix is a log
 * line, which fires in every environment alike and simply says nothing when
 * the value is fine (the silent case is `realtime-lock-ttl-floor-silent.spec.ts`).
 *
 * Its own file, not a `describe` alongside the silent case, for the same
 * reason `realtime-logging.spec.ts` gives for being its own file: `LOG_LEVEL`
 * and the pino destination must be in place before `AppModule` is imported.
 * That reasoning turned out to run deeper than expected here — booting a
 * *second* `startRealtimeTestApp` app later in the *same* file, even with a
 * fresh `Params` provider override, left the second app's `onLogLine`
 * capturing nothing at all (observed directly: a mutation that made the
 * gateway warn unconditionally still produced an empty `emitted` array for
 * the second boot). Nothing in this fix touches why — nestjs-pino's `Logger`
 * plumbing evidently does not isolate as cleanly across two in-process Nest
 * applications as two separate Jest module registries do — so each TTL case
 * gets the one boot the existing harness is proven to support.
 */

import type { RealtimeTestApp } from './testing/realtime-test-app';
import { startRealtimeTestApp } from './testing/realtime-test-app';
import { REALTIME_LOCK_TTL_WARN_FLOOR_MS } from './realtime.gateway';

const FLOOR_WARNING_MESSAGE =
  'REALTIME_LOCK_TTL_MS is below the documented floor (doc/decision/0110-*): the client renewal budget may no longer fit inside the hold before it lapses';

describe('the REALTIME_LOCK_TTL_MS floor warning, below the floor', () => {
  let harness: RealtimeTestApp;
  const emitted: string[] = [];
  const originalEnv = { ...process.env };
  const shortTtlMs = REALTIME_LOCK_TTL_WARN_FLOOR_MS - 1;

  beforeAll(async () => {
    harness = await startRealtimeTestApp({
      lockTtlMs: shortTtlMs,
      logLevel: 'warn',
      onLogLine: (line) => emitted.push(line),
    });
  });

  afterAll(async () => {
    await harness?.close();
    process.env = originalEnv;
  });

  /** Every line pino has emitted so far, parsed, oldest first. */
  function parsedLines(): Record<string, unknown>[] {
    return emitted
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  /**
   * `onModuleInit` runs synchronously during `app.init()`, so by the time
   * `startRealtimeTestApp` resolves in `beforeAll` the warning has already
   * been written. Polled rather than trusted outright, in case pino's own
   * write ever becomes async under a different destination.
   */
  async function waitForFloorWarning(
    timeoutMs = 1000
  ): Promise<Record<string, unknown> | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = parsedLines().find((line) => line['message'] === FLOOR_WARNING_MESSAGE);
      if (found !== undefined || Date.now() > deadline) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it('warns at boot, naming the variable and its configured value', async () => {
    const warning = await waitForFloorWarning();

    expect(warning).toBeDefined();
    // The variable's name and the configured value, so an operator can act on
    // it — never a token or anything else that travels through this logger.
    expect(warning?.['REALTIME_LOCK_TTL_MS']).toBe(shortTtlMs);
    expect(warning?.['floorMs']).toBe(REALTIME_LOCK_TTL_WARN_FLOOR_MS);
    expect(warning?.['level']).toBe('warn');
  });
});
