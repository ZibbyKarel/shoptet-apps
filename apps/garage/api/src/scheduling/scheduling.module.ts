import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ScheduledJobRunner } from './scheduled-job-runner';

/**
 * In-process scheduling.
 *
 * `ScheduleModule.forRoot()` is registered **here and nowhere else**: it
 * installs the `SchedulerOrchestrator`, which is what discovers `@Cron`
 * handlers and — just as importantly — stops their timers in
 * `onApplicationShutdown`, so a SIGTERM is not held open by a pending tick.
 * Registering it twice would mean two orchestrators discovering the same
 * handlers and firing each job twice.
 *
 * A module of its own rather than a folder inside `slack/`, because scheduling
 * is not a Slack concept: the daily summary happens to be the first job, and
 * {@link ScheduledJobRunner} is what any second one should be built on. What
 * "runs twice under two replicas" means, and how to fix it if that day comes,
 * is documented on that class.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [ScheduledJobRunner],
  exports: [ScheduledJobRunner],
})
export class SchedulingModule {}
