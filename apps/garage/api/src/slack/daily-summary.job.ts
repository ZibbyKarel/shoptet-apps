/**
 * The daily summary job: one Slack message a morning, saying what the parking
 * lot looks like today.
 *
 * ## Why `CronJob` is built here instead of `@Cron('0 8 * * *')`
 *
 * The decorator takes a literal, and the time is configuration
 * (`SLACK_DAILY_SUMMARY_AT`). Registering the job through `SchedulerRegistry`
 * keeps the time in the environment where an operator can change it, and it
 * keeps the shutdown behaviour: `SchedulerOrchestrator.beforeApplicationShutdown`
 * deletes every job *in the registry*, decorator-mounted or not, and
 * `deleteCronJob` stops it — so the timer cannot hold a SIGTERM open.
 *
 * ## Why a time zone and not an interval
 *
 * "Every 24 hours" and "at 08:00 in Prague" are the same thing for 363 days a
 * year. On the last Sunday of March the Prague day is 23 hours long and on the
 * last Sunday of October it is 25, so an interval drifts an hour twice a year
 * and stays wrong until someone restarts the process. `CronJob` is given
 * `timeZone: PRAGUE_TIME_ZONE` and computes each fire time in that zone, which
 * is the only construction that puts the message in front of people at 08:00
 * local on both sides. `daily-summary.job.spec.ts` asserts exactly that, by
 * reading the job's own next fire times across both 2026 transitions.
 *
 * The same reasoning governs *which day* is summarised: `todayInPrague()`, not
 * `new Date().toISOString().slice(0, 10)`. At 08:00 Prague the UTC date happens
 * to agree, but the job is also called directly by tests and could be moved to
 * 00:30, where UTC would still be on yesterday.
 *
 * ## Non-business days
 *
 * The cron fires every day; the body returns early on weekends and Czech public
 * holidays, using `isBusinessDay` from `@garage/shared-types` — the same
 * predicate `ReservationPolicy` refuses a reservation with
 * (`doc/decision/0064-*`). Encoding "weekdays" in the cron expression instead
 * would have covered Saturday and Sunday but not 28 September, and would have
 * been a second, weaker definition of a business day.
 *
 * ## Two instances
 *
 * Both would post. See `ScheduledJobRunner`, which owns that limitation and the
 * upgrade path out of it.
 */

import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { DateOnly } from '@garage/shared-types';
import { PRAGUE_TIME_ZONE, isBusinessDay, todayInPrague } from '@garage/shared-types';
import { ScheduledJobRunner } from '../scheduling/scheduled-job-runner';
import { SlackConfig } from './slack.config';
import { SlackNotificationService } from './slack-notification.service';

/** The job's name in `SchedulerRegistry` and in every log line it writes. */
export const DAILY_SUMMARY_JOB_NAME = 'slack-daily-summary';

/**
 * `HH:MM` → a five-field cron expression firing at that minute every day.
 *
 * Exported so the spec can pin the conversion on its own, including the leading
 * zeros: `08` is a valid cron field, but `Number` is applied anyway so the
 * expression reads the way a person would write it and an accidental `008`
 * could not slip through.
 */
export function dailyCronExpression(timeOfDay: string): string {
  const [hours, minutes] = timeOfDay.split(':');
  return `${Number(minutes)} ${Number(hours)} * * *`;
}

@Injectable()
export class DailySummaryJob implements OnModuleInit {
  constructor(
    private readonly config: SlackConfig,
    private readonly notifications: SlackNotificationService,
    private readonly runner: ScheduledJobRunner,
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectPinoLogger(DailySummaryJob.name) private readonly logger: PinoLogger
  ) {}

  onModuleInit(): void {
    const job = this.createCronJob();
    this.schedulerRegistry.addCronJob(DAILY_SUMMARY_JOB_NAME, job);
    job.start();
    this.logger.info(
      {
        job: DAILY_SUMMARY_JOB_NAME,
        cron: dailyCronExpression(this.config.dailySummaryAt),
        timeZone: PRAGUE_TIME_ZONE,
        // Not whether it will be *sent* — the job runs and logs either way, so
        // an operator can see it working before turning Slack on.
        slackEnabled: this.config.target !== undefined,
      },
      'Daily summary job scheduled'
    );
  }

  /**
   * The `CronJob`, built but not started.
   *
   * Public so `daily-summary.job.spec.ts` can ask it for its next fire times
   * without starting a timer — which is how the DST behaviour is measured
   * against the real scheduler rather than against a reimplementation of it.
   */
  createCronJob(): CronJob {
    return CronJob.from({
      cronTime: dailyCronExpression(this.config.dailySummaryAt),
      timeZone: PRAGUE_TIME_ZONE,
      // `runner.run` never rejects, and `void` is what says the tick is not
      // awaited — `cron` ignores a returned promise either way.
      onTick: () => {
        void this.runOnce();
      },
      start: false,
    });
  }

  /**
   * One run of the job body, guarded by {@link ScheduledJobRunner}.
   *
   * @param now Injectable clock. Every caller in the application uses the
   *   default; the parameter exists because "which Prague day is it" is the
   *   assumption most worth testing and least worth mocking globally.
   */
  async runOnce(now: Date = new Date()): Promise<void> {
    await this.runner.run(DAILY_SUMMARY_JOB_NAME, async () => {
      const date: DateOnly = todayInPrague(now);
      if (!isBusinessDay(date)) {
        this.logger.info({ job: DAILY_SUMMARY_JOB_NAME, date }, 'Not a business day; no summary');
        return;
      }
      const outcome = await this.notifications.postDailySummary(date);
      this.logger.info({ job: DAILY_SUMMARY_JOB_NAME, date, outcome }, 'Daily summary posted');
    });
  }
}
