import { captureLogs } from '../slack/testing/capture-logs';
import type { CapturedLogs } from '../slack/testing/capture-logs';
import type { ShutdownCloser } from '../shutdown/graceful-shutdown.service';
import { GracefulShutdownService } from '../shutdown/graceful-shutdown.service';
import { ScheduledJobRunner } from './scheduled-job-runner';

/** A promise plus its resolver, for holding a job body open. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ScheduledJobRunner', () => {
  let logs: CapturedLogs;
  let shutdown: GracefulShutdownService;
  let runner: ScheduledJobRunner;
  /** The closer the runner registered, so shutdown can be driven for real. */
  let closers: Map<string, ShutdownCloser>;

  beforeEach(() => {
    logs = captureLogs();
    closers = new Map();
    shutdown = {
      registerCloser(name: string, close: ShutdownCloser): void {
        closers.set(name, close);
      },
    } as unknown as GracefulShutdownService;
    runner = new ScheduledJobRunner(logs.logger, shutdown);
  });

  function levels(): string[] {
    return logs.lines().map((line) => String(line['level']));
  }

  it('registers itself with the shutdown registry, under a greppable name', () => {
    expect([...closers.keys()]).toEqual(['scheduled-jobs']);
  });

  describe('a body that succeeds', () => {
    it('runs it and reports it ran', async () => {
      const body = jest.fn().mockResolvedValue(undefined);

      await expect(runner.run('nightly', body)).resolves.toBe('ran');

      expect(body).toHaveBeenCalledTimes(1);
      expect(runner.runningJobNames()).toEqual([]);
    });
  });

  describe('a body that throws', () => {
    it('does not reject — a timer has nobody to hand an error to', async () => {
      await expect(runner.run('nightly', () => Promise.reject(new Error('boom')))).resolves.toBe(
        'failed'
      );
    });

    it('logs the error with its stack, because a job has no response to leak into', async () => {
      await runner.run('nightly', () => Promise.reject(new Error('boom')));

      const line = logs.lines().find((entry) => entry['level'] === 'error');
      expect(line).toMatchObject({ job: 'nightly' });
      expect(JSON.stringify(line?.['err'])).toContain('boom');
    });

    it('releases the job so the next tick can run', async () => {
      await runner.run('nightly', () => Promise.reject(new Error('boom')));

      await expect(runner.run('nightly', () => Promise.resolve())).resolves.toBe('ran');
    });

    it('catches a body that throws *before* returning a promise', async () => {
      // The three cases above all reject a promise the guard is already
      // holding. A plain (non-`async`) function that throws on its first line
      // never returns one — and with `body()` called outside the `try`, that
      // threw straight out of `run`, past the guard, into a timer callback with
      // nobody to catch it. "Never rejects" has to mean this too.
      const throwsSynchronously = (): Promise<void> => {
        throw new Error('boom before the promise');
      };

      await expect(runner.run('nightly', throwsSynchronously)).resolves.toBe('failed');

      const line = logs.lines().find((entry) => entry['level'] === 'error');
      expect(JSON.stringify(line?.['err'])).toContain('boom before the promise');
      // …and it did not leave a claim behind that would block every later tick.
      expect(runner.runningJobNames()).toEqual([]);
      await expect(runner.run('nightly', () => Promise.resolve())).resolves.toBe('ran');
    });
  });

  describe('overlapping runs', () => {
    it('refuses the second one while the first is still in flight', async () => {
      const first = deferred();
      const secondBody = jest.fn().mockResolvedValue(undefined);

      const running = runner.run('nightly', () => first.promise);
      // Awaited before the first resolves: this is the overlap, not a sequence.
      await expect(runner.run('nightly', secondBody)).resolves.toBe('skipped-overlapping');
      expect(secondBody).not.toHaveBeenCalled();
      expect(runner.runningJobNames()).toEqual(['nightly']);

      first.resolve();
      await expect(running).resolves.toBe('ran');
    });

    it('does not block a different job', async () => {
      const first = deferred();
      const running = runner.run('nightly', () => first.promise);

      await expect(runner.run('weekly', () => Promise.resolve())).resolves.toBe('ran');

      first.resolve();
      await running;
    });

    it('holds the claim before the body starts, not after it returns', async () => {
      // `claim` acquires; it does not merely test. The window this pins is the
      // body's own synchronous prefix — the one place the entry used not to
      // exist yet, and the one a distributed lock would have to cover.
      let namesDuringSynchronousPrefix: string[] = [];
      const body = (): Promise<void> => {
        namesDuringSynchronousPrefix = runner.runningJobNames();
        return Promise.resolve();
      };

      await expect(runner.run('nightly', body)).resolves.toBe('ran');

      expect(namesDuringSynchronousPrefix).toEqual(['nightly']);
      expect(runner.runningJobNames()).toEqual([]);
    });

    it('lets the job run again once the previous one has finished', async () => {
      await runner.run('nightly', () => Promise.resolve());

      await expect(runner.run('nightly', () => Promise.resolve())).resolves.toBe('ran');
    });
  });

  describe('shutdown', () => {
    it('waits for an in-flight job before letting the process exit', async () => {
      const held = deferred();
      let finished = false;
      const running = runner.run('nightly', async () => {
        await held.promise;
        finished = true;
      });

      let drained = false;
      const draining = Promise.resolve(closers.get('scheduled-jobs')?.()).then(() => {
        drained = true;
      });

      // A full macrotask turn, not a microtask flush: if the closer resolved
      // without waiting, `drained` would be true by now.
      await new Promise((resolve) => setImmediate(resolve));
      expect(drained).toBe(false);
      expect(finished).toBe(false);

      held.resolve();
      await draining;
      await running;
      expect(drained).toBe(true);
      expect(finished).toBe(true);
    });

    it('does not hang when nothing is running', async () => {
      await expect(Promise.resolve(closers.get('scheduled-jobs')?.())).resolves.toBeUndefined();
    });

    it('is not held open by a job that fails while draining', async () => {
      const held = deferred();
      const running = runner.run('nightly', () => held.promise);

      const draining = Promise.resolve(closers.get('scheduled-jobs')?.());
      held.reject(new Error('boom'));

      await expect(draining).resolves.toBeUndefined();
      await expect(running).resolves.toBe('failed');
    });

    it('refuses to start a new job once shutdown has begun', async () => {
      await closers.get('scheduled-jobs')?.();
      const body = jest.fn();

      await expect(runner.run('nightly', body)).resolves.toBe('skipped-shutting-down');

      expect(body).not.toHaveBeenCalled();
    });

    it('refuses new jobs after Nest’s own shutdown hook, even without the closer', async () => {
      // The second guard: if the closer registration were ever removed, a tick
      // arriving during shutdown must still not open a database read against a
      // pool that is closing.
      runner.onApplicationShutdown();

      await expect(runner.run('nightly', jest.fn())).resolves.toBe('skipped-shutting-down');
    });
  });

  it('never logs an overlap or a skip at error level — neither is a fault', async () => {
    const held = deferred();
    const running = runner.run('nightly', () => held.promise);
    await runner.run('nightly', jest.fn());
    held.resolve();
    await running;

    expect(levels()).not.toContain('error');
  });
});
