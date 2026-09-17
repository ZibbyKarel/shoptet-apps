/**
 * The Slack configuration, read once from the validated environment.
 *
 * A class rather than an interface so it can be its own injection token — the
 * same trick `DomainEventPublisher` uses — which means a test can hand a
 * different configuration to `SlackClient` without a string token nobody can
 * find by "go to definition".
 *
 * ## Why "enabled" is the absence of a field rather than a boolean
 *
 * `validateApiEnv` already refuses to boot with `SLACK_ENABLED=true` and no
 * token or channel. That refinement earns a *type*: {@link SlackTarget} is
 * present exactly when Slack is on, and every credential and destination lives
 * inside it. A `boolean` plus two optional strings would have said the same
 * thing to a reader and nothing at all to the compiler, and every call site
 * would have grown a `?? ''` that is unreachable and therefore untested.
 */

import type { ApiEnv } from '../env';

/** Where messages go, and what they are sent with. Present only when enabled. */
export interface SlackTarget {
  /** The bot token. **Never log this** — see `./slack-token-redaction.ts`. */
  readonly botToken: string;
  /** Channel for the freed-spot notice and the daily summary. */
  readonly channelId: string;
}

export class SlackConfig {
  constructor(
    /** `undefined` means Slack is off: every send becomes a logged no-op. */
    readonly target: SlackTarget | undefined,
    /** Per-attempt HTTP timeout. */
    readonly requestTimeoutMs: number,
    /** Total attempts, the first included. `1` disables retrying. */
    readonly retryAttempts: number,
    /** First backoff delay; doubled per further attempt. */
    readonly retryBaseDelayMs: number,
    /** `HH:MM` in Europe/Prague. */
    readonly dailySummaryAt: string
  ) {}

  static fromEnv(env: SlackEnv): SlackConfig {
    return new SlackConfig(
      targetFromEnv(env),
      env.SLACK_REQUEST_TIMEOUT_MS,
      env.SLACK_RETRY_ATTEMPTS,
      env.SLACK_RETRY_BASE_DELAY_MS,
      env.SLACK_DAILY_SUMMARY_AT
    );
  }
}

/**
 * Throws when handed `SLACK_ENABLED=true` without the two variables that makes
 * meaningless. The environment schema catches that first in the running
 * application, so this is the same rule stated a second time where the compiler
 * can use it — and it is reachable (and exercised) by calling `fromEnv` with a
 * hand-built object, which is exactly what a future refactor of the schema
 * would do by accident.
 */
function targetFromEnv(env: SlackEnv): SlackTarget | undefined {
  if (!env.SLACK_ENABLED) {
    return undefined;
  }
  const { SLACK_BOT_TOKEN: botToken, SLACK_CHANNEL_ID: channelId } = env;
  if (botToken === undefined || channelId === undefined) {
    // Names the variables, never their values.
    throw new Error('SLACK_ENABLED=true requires SLACK_BOT_TOKEN and SLACK_CHANNEL_ID');
  }
  return { botToken, channelId };
}

/** Exactly the keys of `ApiEnv` this module reads. */
export type SlackEnv = Pick<
  ApiEnv,
  | 'SLACK_ENABLED'
  | 'SLACK_BOT_TOKEN'
  | 'SLACK_CHANNEL_ID'
  | 'SLACK_REQUEST_TIMEOUT_MS'
  | 'SLACK_RETRY_ATTEMPTS'
  | 'SLACK_RETRY_BASE_DELAY_MS'
  | 'SLACK_DAILY_SUMMARY_AT'
>;
