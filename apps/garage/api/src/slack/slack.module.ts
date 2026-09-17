import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../env';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { DailySummaryJob } from './daily-summary.job';
import {
  DefaultSlackWebClientFactory,
  SlackClient,
  SlackWebClientFactory,
} from './slack-client.service';
import { SlackDomainEventPublisher } from './slack-domain-event.publisher';
import { SlackNotificationService } from './slack-notification.service';
import { SlackConfig } from './slack.config';

/**
 * Outbound Slack notifications and the job that posts the daily summary.
 *
 * **Outbound only.** There is no controller in this module and there is no
 * route anywhere in `apps/garage/api` that Slack could call: no slash command, no
 * interactive Block Kit, no events subscription, and consequently no request
 * signature to verify. `plan.md` states that as a scope boundary, and the
 * absence of a controller here is what enforces it — a reviewer does not have
 * to trust a comment.
 *
 * ## What is exported and why
 *
 * `SlackDomainEventPublisher` is exported because `ReservationsModule` injects
 * it into the delegate list behind the after-commit seam Task 13 left
 * (`reservations/composite-domain-event.publisher.ts`). It is **not** bound to
 * the `DomainEventPublisher` token directly — Task 15's Socket.io publisher
 * implements the same seam, and one token resolves to one provider, so the
 * token is bound to the composite and both implementations sit behind it.
 *
 * What the export still has to guarantee is what Task 16's original
 * `useExisting` guaranteed: the instance reached through the seam is the one
 * **this** module built. That matters because of
 * `SlackDomainEventPublisher.inFlight` — a second instance would drain an empty
 * set on `SIGTERM` while a real notification was still in the air.
 * `slack.module.spec.ts` asserts the identity through the composite.
 *
 * Nothing else leaves this module: `SlackClient` is the single importer of
 * `@slack/web-api` and stays that way.
 *
 * `SlackConfig` is built from `ConfigService` rather than read key-by-key at
 * every use site, so "enabled" is a single fact with a single type
 * (see `./slack.config.ts`), and a test can substitute a whole configuration.
 *
 * `PrismaService` needs no import: `DatabaseModule` is `@Global()`.
 */
@Module({
  imports: [SchedulingModule],
  providers: [
    {
      provide: SlackConfig,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<ApiEnv, true>) =>
        SlackConfig.fromEnv({
          SLACK_ENABLED: configService.get('SLACK_ENABLED', { infer: true }),
          SLACK_BOT_TOKEN: configService.get('SLACK_BOT_TOKEN', { infer: true }),
          SLACK_CHANNEL_ID: configService.get('SLACK_CHANNEL_ID', { infer: true }),
          SLACK_REQUEST_TIMEOUT_MS: configService.get('SLACK_REQUEST_TIMEOUT_MS', { infer: true }),
          SLACK_RETRY_ATTEMPTS: configService.get('SLACK_RETRY_ATTEMPTS', { infer: true }),
          SLACK_RETRY_BASE_DELAY_MS: configService.get('SLACK_RETRY_BASE_DELAY_MS', {
            infer: true,
          }),
          SLACK_DAILY_SUMMARY_AT: configService.get('SLACK_DAILY_SUMMARY_AT', { infer: true }),
        }),
    },
    { provide: SlackWebClientFactory, useClass: DefaultSlackWebClientFactory },
    SlackClient,
    SlackNotificationService,
    SlackDomainEventPublisher,
    DailySummaryJob,
  ],
  exports: [SlackDomainEventPublisher],
})
export class SlackModule {}
