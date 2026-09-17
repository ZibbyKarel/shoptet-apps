/**
 * `RealtimeGateway.onModuleInit` says nothing when `REALTIME_LOCK_TTL_MS` is
 * at a normal production value.
 *
 * The negative half of the guarantee `realtime-lock-ttl-floor-warning.spec.ts`
 * checks the positive half of; see that file's header for why this is a
 * separate file with its own single `startRealtimeTestApp` boot rather than a
 * second `describe` sharing one.
 */

import type { RealtimeTestApp } from './testing/realtime-test-app';
import { startRealtimeTestApp } from './testing/realtime-test-app';

const FLOOR_WARNING_MESSAGE =
  'REALTIME_LOCK_TTL_MS is below the documented floor (doc/decision/0110-*): the client renewal budget may no longer fit inside the hold before it lapses';

describe('the REALTIME_LOCK_TTL_MS floor warning, at a normal TTL', () => {
  let harness: RealtimeTestApp;
  const emitted: string[] = [];
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    harness = await startRealtimeTestApp({
      // The production default (`ENV_DEFAULTS.REALTIME_LOCK_TTL_MS`), not
      // merely a value above the floor: this is what an operator who never
      // touches the key actually runs.
      lockTtlMs: 30_000,
      logLevel: 'warn',
      onLogLine: (line) => emitted.push(line),
    });

    // A negative claim needs a window: `onModuleInit` has already run by the
    // time `startRealtimeTestApp` resolves, so this is not a race against a
    // slow write, only against there being nothing to find at all.
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  afterAll(async () => {
    await harness?.close();
    process.env = originalEnv;
  });

  it('emits no floor warning', () => {
    const lines = emitted
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines.some((line) => line['message'] === FLOOR_WARNING_MESSAGE)).toBe(false);
  });
});
