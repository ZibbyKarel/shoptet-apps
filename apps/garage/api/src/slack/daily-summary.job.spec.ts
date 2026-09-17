/**
 * The daily summary job: when it fires, in which zone, and what it does when it
 * does.
 *
 * ## How the time-zone claim is measured
 *
 * "The cron is scheduled in the correct zone" is easy to write and hard to
 * check, because the bug it guards against only appears twice a year. This spec
 * asks the **real `CronJob` the application registers** for its own next fire
 * times across both 2026 Prague transitions and asserts three things about
 * them: each is 08:00 *Prague* local; the UTC instants shift by exactly one
 * hour across the boundary; and the two neighbouring runs are 23 and 25 hours
 * apart, which is the fact an interval-based scheduler gets wrong.
 *
 * `jest.setSystemTime` moves the clock; nothing is reimplemented.
 */

import { SchedulerRegistry } from '@nestjs/schedule';
import type { CronJob } from 'cron';
import { PRAGUE_TIME_ZONE } from '@garage/shared-types';
import { ScheduledJobRunner } from '../scheduling/scheduled-job-runner';
import { GracefulShutdownService } from '../shutdown/graceful-shutdown.service';
import { DAILY_SUMMARY_JOB_NAME, DailySummaryJob, dailyCronExpression } from './daily-summary.job';
import type { SlackNotificationService } from './slack-notification.service';
import { SlackConfig } from './slack.config';
import type { CapturedLogs } from './testing/capture-logs';
import { captureLogs } from './testing/capture-logs';

/** Renders an instant as `YYYY-MM-DD HH:mm` in Prague, for readable assertions. */
function inPrague(instant: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
  return parts.replace('T', ' ');
}

/** Whole hours between two fire times, or a failure naming what was missing. */
function hoursBetween(times: Date[], from: number, to: number): number {
  const start = times[from];
  const end = times[to];
  if (start === undefined || end === undefined) {
    throw new Error(`Expected fire times #${from} and #${to}; got ${times.length}`);
  }
  return (end.getTime() - start.getTime()) / 3_600_000;
}

function buildConfig(dailySummaryAt = '08:00'): SlackConfig {
  return SlackConfig.fromEnv({
    SLACK_ENABLED: false,
    SLACK_BOT_TOKEN: undefined,
    SLACK_CHANNEL_ID: undefined,
    SLACK_REQUEST_TIMEOUT_MS: 5_000,
    SLACK_RETRY_ATTEMPTS: 3,
    SLACK_RETRY_BASE_DELAY_MS: 500,
    SLACK_DAILY_SUMMARY_AT: dailySummaryAt,
  });
}

describe('dailyCronExpression', () => {
  it.each([
    ['08:00', '0 8 * * *'],
    ['00:00', '0 0 * * *'],
    ['23:59', '59 23 * * *'],
    ['07:05', '5 7 * * *'],
  ])('turns %p into %p', (timeOfDay, expected) => {
    expect(dailyCronExpression(timeOfDay)).toBe(expected);
  });
});

describe('DailySummaryJob', () => {
  let logs: CapturedLogs;
  let notifications: { postDailySummary: jest.Mock };
  let registry: SchedulerRegistry;
  let job: DailySummaryJob;

  beforeEach(() => {
    logs = captureLogs();
    notifications = { postDailySummary: jest.fn().mockResolvedValue('disabled') };
    registry = new SchedulerRegistry();
    job = new DailySummaryJob(
      buildConfig(),
      notifications as unknown as SlackNotificationService,
      new ScheduledJobRunner(logs.logger, {
        registerCloser: () => undefined,
      } as unknown as GracefulShutdownService),
      registry,
      logs.logger
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('registration', () => {
    it('puts the job in SchedulerRegistry, which is what stops it on SIGTERM', () => {
      job.onModuleInit();

      // `SchedulerOrchestrator.beforeApplicationShutdown` deletes every job in
      // the registry, and `deleteCronJob` stops it. A job started outside the
      // registry would keep a timer alive and hold the process open.
      expect([...registry.getCronJobs().keys()]).toEqual([DAILY_SUMMARY_JOB_NAME]);
      expect(registry.getCronJob(DAILY_SUMMARY_JOB_NAME).isActive).toBe(true);

      registry.deleteCronJob(DAILY_SUMMARY_JOB_NAME);
    });

    it('logs the schedule it installed, including the zone', () => {
      job.onModuleInit();

      expect(logs.lines()).toContainEqual(
        expect.objectContaining({
          job: DAILY_SUMMARY_JOB_NAME,
          cron: '0 8 * * *',
          timeZone: 'Europe/Prague',
        })
      );

      registry.deleteCronJob(DAILY_SUMMARY_JOB_NAME);
    });
  });

  describe('the fire times across a DST boundary', () => {
    /** The next `count` fire times of the real job, from `from`. */
    function fireTimes(from: string, count: number, at = '08:00'): Date[] {
      jest.useFakeTimers({ now: new Date(from), doNotFake: ['nextTick', 'setImmediate'] });
      const cron: CronJob = new DailySummaryJob(
        buildConfig(at),
        notifications as unknown as SlackNotificationService,
        new ScheduledJobRunner(logs.logger, {
          registerCloser: () => undefined,
        } as unknown as GracefulShutdownService),
        registry,
        logs.logger
      ).createCronJob();
      return cron.nextDates(count).map((date) => date.toJSDate());
    }

    it('fires at 08:00 Prague on both sides of the spring transition', () => {
      // 2026-03-29 is the Sunday Prague goes CET → CEST at 02:00 local.
      const times = fireTimes('2026-03-27T00:00:00.000Z', 4);

      expect(times.map(inPrague)).toEqual([
        '2026-03-27 08:00',
        '2026-03-28 08:00',
        '2026-03-29 08:00',
        '2026-03-30 08:00',
      ]);
      // The same local time is a *different* UTC instant on the two sides.
      expect(times.map((t) => t.toISOString())).toEqual([
        '2026-03-27T07:00:00.000Z',
        '2026-03-28T07:00:00.000Z',
        '2026-03-29T06:00:00.000Z',
        '2026-03-30T06:00:00.000Z',
      ]);
      // 23 hours, not 24. An interval-based scheduler would drift here.
      expect(hoursBetween(times, 1, 2)).toBe(23);
    });

    it('fires at 08:00 Prague on both sides of the autumn transition', () => {
      // 2026-10-25 is the Sunday Prague goes CEST → CET at 03:00 local.
      const times = fireTimes('2026-10-23T00:00:00.000Z', 4);

      expect(times.map(inPrague)).toEqual([
        '2026-10-23 08:00',
        '2026-10-24 08:00',
        '2026-10-25 08:00',
        '2026-10-26 08:00',
      ]);
      expect(times.map((t) => t.toISOString())).toEqual([
        '2026-10-23T06:00:00.000Z',
        '2026-10-24T06:00:00.000Z',
        '2026-10-25T07:00:00.000Z',
        '2026-10-26T07:00:00.000Z',
      ]);
      // 25 hours.
      expect(hoursBetween(times, 1, 2)).toBe(25);
    });

    it('follows SLACK_DAILY_SUMMARY_AT rather than a hard-coded hour', () => {
      const times = fireTimes('2026-03-28T00:00:00.000Z', 2, '06:30');

      expect(times.map(inPrague)).toEqual(['2026-03-28 06:30', '2026-03-29 06:30']);
    });

    it('still fires once on the day whose 02:30 does not exist', () => {
      // 02:30 Prague never happens on 2026-03-29: the clock jumps 02:00 → 03:00.
      // Measured, not assumed — `cron` clamps to 03:00 rather than skipping the
      // day or firing twice. Pinned here so that anyone tempted to move
      // `SLACK_DAILY_SUMMARY_AT` into the gap can see what they would get, and
      // so a library upgrade that changed it would fail loudly.
      const times = fireTimes('2026-03-28T00:00:00.000Z', 3, '02:30');

      expect(times.map(inPrague)).toEqual([
        '2026-03-28 02:30',
        '2026-03-29 03:00',
        '2026-03-30 02:30',
      ]);
    });
  });

  describe('the body', () => {
    it('summarises today in Prague, not today in UTC', async () => {
      // 23:30 UTC on 4 January is already 00:30 on 5 January in Prague. A job
      // reading the UTC date would summarise the wrong day.
      await job.runOnce(new Date('2027-01-04T23:30:00.000Z'));

      expect(notifications.postDailySummary).toHaveBeenCalledWith('2027-01-05');
    });

    it.each([
      ['a Saturday', '2026-09-26T06:00:00.000Z'],
      ['a Sunday', '2026-09-27T06:00:00.000Z'],
      ['a Czech public holiday on a weekday', '2026-09-28T06:00:00.000Z'],
    ])('posts nothing on %s', async (_name, instant) => {
      await job.runOnce(new Date(instant));

      expect(notifications.postDailySummary).not.toHaveBeenCalled();
      expect(logs.lines()).toContainEqual(
        expect.objectContaining({ message: 'Not a business day; no summary' })
      );
    });

    it('posts on an ordinary weekday', async () => {
      await job.runOnce(new Date('2026-09-29T06:00:00.000Z'));

      expect(notifications.postDailySummary).toHaveBeenCalledWith('2026-09-29');
    });

    it('records the delivery outcome, so a disabled Slack is still visible', async () => {
      notifications.postDailySummary.mockResolvedValue('delivered');

      await job.runOnce(new Date('2026-09-29T06:00:00.000Z'));

      expect(logs.lines()).toContainEqual(
        expect.objectContaining({ message: 'Daily summary posted', outcome: 'delivered' })
      );
    });

    it('does not reject when the summary fails — a timer has no caller', async () => {
      notifications.postDailySummary.mockRejectedValue(new Error('database down'));

      await expect(job.runOnce(new Date('2026-09-29T06:00:00.000Z'))).resolves.toBeUndefined();

      expect(logs.lines()).toContainEqual(
        expect.objectContaining({ message: 'Scheduled job failed', job: DAILY_SUMMARY_JOB_NAME })
      );
    });

    it('goes through the runner, so two overlapping ticks post once', async () => {
      let release!: () => void;
      notifications.postDailySummary.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve('delivered');
          })
      );

      const first = job.runOnce(new Date('2026-09-29T06:00:00.000Z'));
      await job.runOnce(new Date('2026-09-29T06:00:00.000Z'));

      expect(notifications.postDailySummary).toHaveBeenCalledTimes(1);
      release();
      await first;
    });
  });
});
