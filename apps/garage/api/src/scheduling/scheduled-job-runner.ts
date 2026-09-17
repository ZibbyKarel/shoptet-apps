/**
 * The one place a scheduled job body actually runs.
 *
 * `@nestjs/schedule` gives us a timer that fires in the right time zone. It
 * gives us nothing else: a `@Cron` handler that throws produces an unhandled
 * rejection, a handler still running when the next tick arrives runs twice
 * concurrently, and a handler in flight when SIGTERM lands is simply abandoned
 * mid-write. This class is the shared answer to all three, so that every job in
 * this application gets them without each job author remembering.
 *
 * It is deliberately small and deliberately *not* a queue. `plan.md` fixes a
 * single-instance deployment for the MVP — no Redis, no BullMQ, no broker — so
 * the guarantee this class can offer is the one an in-process mutex can offer.
 *
 * ## What happens with two instances
 *
 * **Every replica runs every job.** `runningJobs` is a `Map` in one Node
 * process; it says nothing about what a second process is doing. Two replicas
 * at 08:00 Prague post the daily summary twice, to the same channel, a
 * millisecond apart. Nothing corrupts — the jobs in this application only read
 * the database and post to Slack — but a user sees the message twice.
 *
 * That is a **known, accepted limitation of the MVP**, and it is stated rather
 * than defended: nobody has scaled this app, and this comment is what a person
 * who does will find.
 *
 * ### The upgrade path, in the order it should be taken
 *
 * 1. **Leader election.** The cheapest change that keeps everything else. Take
 *    a PostgreSQL advisory lock (`pg_try_advisory_lock(<hash of name>)`) at the
 *    top of {@link run} and release it at the end; a replica that does not get
 *    it returns `'skipped-elsewhere'` and logs. The database is already the
 *    only shared thing in the deployment, so this adds no infrastructure. It
 *    replaces the body of {@link claim}/{@link release} below and nothing else.
 *    This is the same shape `LockService` (Task 15) documents for cell locks.
 * 2. **A repeatable-job queue** (BullMQ on Redis) if jobs ever need retries
 *    across a restart, a durable history, or fan-out to workers. At that point
 *    the `@Cron` registration moves to a queue producer, this class becomes the
 *    worker's processor, and the advisory lock is no longer needed because the
 *    queue itself is the arbiter. This is a real infrastructure decision and
 *    should not be taken merely to avoid a duplicate Slack message.
 *
 * Neither is built now. Building an unused distributed lock would be an
 * abstraction with one implementation and no second caller to check it against.
 */

import type { OnApplicationShutdown } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { GracefulShutdownService } from '../shutdown/graceful-shutdown.service';

/** What one call to {@link ScheduledJobRunner.run} did. */
export type ScheduledJobOutcome =
  /** The body ran to completion. */
  | 'ran'
  /** The body threw; the error was logged and swallowed. */
  | 'failed'
  /** A previous run of the same job was still in flight. */
  | 'skipped-overlapping'
  /** Shutdown had already begun, so nothing was started. */
  | 'skipped-shutting-down';

/** A job body. Takes nothing, returns nothing, may reject. */
export type ScheduledJobBody = () => Promise<void>;

@Injectable()
export class ScheduledJobRunner implements OnApplicationShutdown {
  /** In-flight runs by job name — the single-instance stand-in for a lock. */
  private readonly runningJobs = new Map<string, Promise<void>>();

  private shuttingDown = false;

  constructor(
    @InjectPinoLogger(ScheduledJobRunner.name)
    private readonly logger: PinoLogger,
    gracefulShutdown: GracefulShutdownService
  ) {
    // Registered as a closer rather than relying on this class's own
    // `onApplicationShutdown`, because the order matters: closers run *after*
    // HTTP has stopped accepting connections, and a job that is still writing
    // when `PrismaService` closes the pool would fail on a dead connection.
    gracefulShutdown.registerCloser('scheduled-jobs', () => this.drain());
  }

  /**
   * Runs `body`, guarded.
   *
   * Never rejects: a scheduled job has no caller to hand an error to, and an
   * unhandled rejection out of a timer takes the process down in Node. The
   * outcome is returned instead, which is also what makes the guard testable
   * without reading log output.
   */
  async run(name: string, body: ScheduledJobBody): Promise<ScheduledJobOutcome> {
    if (this.shuttingDown) {
      this.logger.info({ job: name }, 'Scheduled job skipped: shutting down');
      return 'skipped-shutting-down';
    }
    if (!this.claim(name)) {
      // Returned before the `try`, deliberately: the `finally` releases the
      // claim, and a skipped run must never release the claim held by the run
      // it just lost to.
      //
      // Not an error: the previous run being slow is information, not a fault.
      // A job that reports this every tick is a job whose schedule is wrong.
      this.logger.warn({ job: name }, 'Scheduled job skipped: previous run still in flight');
      return 'skipped-overlapping';
    }

    const startedAt = Date.now();
    try {
      // Inside the `try`, not before it. `body` is typed as returning a promise,
      // but a plain (non-`async`) function that throws *before* returning one
      // throws synchronously — and from out here that escaped the guard and made
      // this method's "never rejects" false, which is the one thing a scheduled
      // job cannot afford: an unhandled rejection out of a timer takes the
      // process down.
      const running = body();
      // Replaces the placeholder `claim` reserved a moment ago with the promise
      // `drain` actually has to wait for. Nothing can observe the placeholder:
      // the only code between the two is `body`'s synchronous prefix.
      this.runningJobs.set(name, running.then(noop, noop));
      await running;
      this.logger.info({ job: name, durationMs: Date.now() - startedAt }, 'Scheduled job finished');
      return 'ran';
    } catch (error) {
      // `err` is kept: unlike a framework 4xx, these frames name the job's own
      // code and are the only record of why it failed. Nothing here is sent to
      // a client — a scheduled job has no response.
      this.logger.error(
        { err: error, job: name, durationMs: Date.now() - startedAt },
        'Scheduled job failed'
      );
      return 'failed';
    } finally {
      this.release(name);
    }
  }

  /** In-flight job names. The unit test reads this instead of guessing. */
  runningJobNames(): string[] {
    return [...this.runningJobs.keys()];
  }

  /**
   * Acquires the claim on `name`, or fails.
   *
   * Acquire-or-fail, and a real acquisition: `true` means this call now holds
   * the claim and the caller must {@link release} it. That is the same shape a
   * distributed lock has, which is what makes step 1 of the upgrade path above
   * a replacement of this method (and {@link release}) and nothing else.
   *
   * The promise stored here is a placeholder — already resolved, so a
   * {@link drain} that somehow saw it would not hang — and {@link run}
   * overwrites it with the body's own promise on the next line.
   */
  private claim(name: string): boolean {
    if (this.runningJobs.has(name)) {
      return false;
    }
    this.runningJobs.set(name, Promise.resolve());
    return true;
  }

  private release(name: string): void {
    this.runningJobs.delete(name);
  }

  /**
   * Stops accepting new runs and waits for the in-flight ones.
   *
   * Called from the shutdown closer, so a SIGTERM that arrives mid-summary
   * still exits cleanly instead of tearing the job in half. In-flight bodies
   * already cannot reject ({@link run} catches), so this cannot throw.
   */
  private async drain(): Promise<void> {
    this.shuttingDown = true;
    if (this.runningJobs.size === 0) {
      return;
    }
    this.logger.info({ jobs: this.runningJobNames() }, 'Waiting for scheduled jobs to finish');
    await Promise.all([...this.runningJobs.values()]);
  }

  /**
   * Nest calls this too. It is a second, independent guard rather than the
   * primary one: if the closer registration were ever removed, a job started
   * after shutdown would still be refused instead of racing a closing pool.
   */
  onApplicationShutdown(): void {
    this.shuttingDown = true;
  }
}

function noop(): void {
  // The stored promise exists only to be awaited by `drain`; its outcome is
  // already handled inside `run`, and an unhandled rejection here would be a
  // second report of the same failure.
}
