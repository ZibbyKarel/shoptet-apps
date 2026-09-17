/**
 * Fail-fast environment schema for apps/garage/api.
 *
 * This is the single source of truth for which environment variables the API
 * needs and what shape they must have. It is wired into Nest via
 * `ConfigModule.forRoot({ validate: validateApiEnv })` in `app.module.ts`,
 * which calls `validateApiEnv` once during module initialization — before the
 * application starts listening — so a missing or malformed variable crashes
 * the process immediately with a readable error instead of failing later at
 * an arbitrary call site.
 *
 * Dev, e2e and production all run this exact same validation; only the
 * values differ (see `.env.example` and `doc/environment.md`).
 *
 * The schema is deliberately minimal for this phase (Fáze 0) and is designed
 * to grow additively: later phases add Slack, ICS and throttler variables as
 * new keys on this object, never by relaxing existing ones.
 */
import * as z from 'zod';

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

/** Levels accepted by nestjs-pino / pino (excludes `silent`, which is not a useful default). */
const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);

/**
 * A comma-separated list of allowed CORS origins, e.g.
 * `http://localhost:4200,http://localhost:3000`. Parsed into a non-empty
 * array of absolute origin URLs — there is no wildcard escape hatch.
 */
const corsAllowedOriginsSchema = z
  .string()
  .min(1, 'must not be empty')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  )
  .pipe(z.array(z.url()).min(1, 'must contain at least one valid origin URL'));

/**
 * Express `body-parser` size limit, e.g. `100kb` or `1mb`. A bare number is
 * rejected on purpose: `limit: 100` means *bytes* to body-parser, which is
 * almost never what someone writing `100` meant.
 */
const byteSizeSchema = z
  .string()
  .regex(/^\d+(\.\d+)?\s?(b|kb|mb|gb)$/i, 'must be a byte size with a unit, e.g. "100kb"');

/** A positive whole number of milliseconds, coerced from its string env value. */
const positiveMillisecondsSchema = z.coerce.number().int().positive();

/** A positive whole request count. */
const positiveCountSchema = z.coerce.number().int().positive();

/**
 * A boolean written the only two ways this project accepts.
 *
 * Deliberately **not** `z.coerce.boolean()`, which treats every non-empty
 * string as `true` — so `SLACK_ENABLED=false` would switch Slack *on*. Only the
 * two literals parse; anything else names the variable and fails the boot.
 */
const booleanFromEnvSchema = z
  .enum(['true', 'false'], { message: 'must be exactly "true" or "false"' })
  .default('false')
  .transform((value) => value === 'true');

/**
 * A wall-clock time of day, `HH:MM`, 24-hour, in Europe/Prague.
 *
 * No `_MS` suffix because this is not a duration: it is the *instant of the
 * day* a cron fires, and 08:00 Prague is a different number of milliseconds
 * from midnight on the two days a year the offset changes. That is exactly why
 * the job is registered with `timeZone: 'Europe/Prague'` rather than an
 * interval — see `apps/garage/api/src/slack/daily-summary.job.ts`.
 */
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24-hour time of day, e.g. "08:00"');

/**
 * Defaults for the operational-baseline keys, exported so that the one place
 * that cannot inject `ConfigService` — the `StrictThrottle()` decorator in
 * `common/throttling/throttle-tiers.ts` — falls back to the same numbers this
 * schema does, instead of a second copy that can drift.
 */
export const ENV_DEFAULTS = {
  THROTTLE_TTL_MS: 60_000,
  THROTTLE_LIMIT: 300,
  THROTTLE_STRICT_TTL_MS: 60_000,
  THROTTLE_STRICT_LIMIT: 20,
  BODY_LIMIT: '100kb',
  HEALTH_DB_TIMEOUT_MS: 3_000,
  REALTIME_LOCK_TTL_MS: 30_000,

  // --- Slack and scheduled jobs (Task 16) --------------------------------
  SLACK_REQUEST_TIMEOUT_MS: 5_000,
  SLACK_RETRY_ATTEMPTS: 3,
  SLACK_RETRY_BASE_DELAY_MS: 500,
  SLACK_DAILY_SUMMARY_AT: '08:00',
} as const;

const apiEnvObjectSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.url(),
  AUTH_OKTA_ISSUER: z.url(),
  AUTH_OKTA_AUDIENCE: z.string().min(1),
  CORS_ALLOWED_ORIGINS: corsAllowedOriginsSchema,
  LOG_LEVEL: logLevelSchema,

  // --- Operational baseline (Task 10) ------------------------------------
  // Everything below has a default. `.env.example` is owned by another task's
  // file set, so a *required* key here would break every existing `.env` with
  // no way for this task to update the example. Defaults are the production
  // values; `doc/environment.md` lists them.

  /** Global rate-limit window, in milliseconds. */
  THROTTLE_TTL_MS: positiveMillisecondsSchema.default(ENV_DEFAULTS.THROTTLE_TTL_MS),
  /**
   * Requests allowed per window, per source IP, on every route.
   *
   * "Per source IP" is literal: `ThrottlerGuard` buckets by `req.ip`, which
   * Express takes from the socket because `trust proxy` is not set. Behind a
   * reverse proxy every client therefore shares one bucket — see the proxy
   * section in `doc/api-operations.md` before deploying behind one.
   */
  THROTTLE_LIMIT: positiveCountSchema.default(ENV_DEFAULTS.THROTTLE_LIMIT),
  /** Window for the stricter, session-less tier (see `StrictThrottle`). */
  THROTTLE_STRICT_TTL_MS: positiveMillisecondsSchema.default(ENV_DEFAULTS.THROTTLE_STRICT_TTL_MS),
  /** Requests allowed per window on routes that opt into the strict tier. */
  THROTTLE_STRICT_LIMIT: positiveCountSchema.default(ENV_DEFAULTS.THROTTLE_STRICT_LIMIT),

  /** Maximum accepted request body, passed to Express' JSON/urlencoded parsers. */
  BODY_LIMIT: byteSizeSchema.default(ENV_DEFAULTS.BODY_LIMIT),

  /**
   * How long `/health/ready` waits for its `SELECT 1` before declaring the
   * database down. Must stay well below the orchestrator's probe timeout, or a
   * hung Postgres produces a hung probe instead of a failing one.
   */
  HEALTH_DB_TIMEOUT_MS: positiveMillisecondsSchema.default(ENV_DEFAULTS.HEALTH_DB_TIMEOUT_MS),

  // --- Realtime (Task 15) -------------------------------------------------

  /**
   * How long a cell's editing hold lasts before it lapses, in milliseconds.
   *
   * 30 s, and the number is not free: `libs/garage/realtime-client` renews at
   * `CELL_LOCK_RENEW_FRACTION` (0.5) of the remaining time and gives a renewal
   * `CELL_LOCK_ACK_ATTEMPTS` (2) attempts of `CELL_LOCK_ACK_TIMEOUT_MS` (5 s)
   * each, so a renewal falling due at ~15 s resolves by ~25 s — inside the same
   * TTL, with margin. A TTL much below ~15 s would leave the client giving up
   * after the hold had already lapsed. See `doc/decision/0110-*`.
   *
   * It is configurable rather than a constant so that tests can run the *same*
   * gateway code against a short TTL: there is no test branch in the realtime
   * path, only a different value here — the rule `apps/garage/api/src/auth` follows for
   * `AUTH_OKTA_ISSUER`.
   */
  REALTIME_LOCK_TTL_MS: positiveMillisecondsSchema.default(ENV_DEFAULTS.REALTIME_LOCK_TTL_MS),

  // --- Slack and scheduled jobs (Task 16) --------------------------------
  // Additive, like the block above: every key has a default, so an existing
  // `.env` keeps working and an installation that wants no Slack has to do
  // nothing at all. See `doc/slack.md` and `doc/decision/0130-*`.

  /**
   * Whether outbound Slack notifications are actually sent.
   *
   * **Defaults to `false`**, which is what keeps a developer's machine from
   * posting into a real workspace — see `doc/decision/0130-*`. It is an env
   * *value*, not a `NODE_ENV` branch: the disabled path runs the same code, it
   * just stops at the one gate repeated in each of `SlackClient`'s three
   * public methods (`postToChannel`, `postDirectMessage`,
   * `lookupUserIdByEmail`).
   */
  SLACK_ENABLED: booleanFromEnvSchema,

  /**
   * The bot token (`xoxb-…`) for `chat.postMessage` and `users.lookupByEmail`.
   *
   * Optional here and **required by the refinement below when
   * `SLACK_ENABLED=true`**, so the failure mode of "enabled but unconfigured"
   * is a boot crash naming the variable rather than a stream of runtime errors.
   * Its value is never logged, never audited and never echoed — see
   * `apps/garage/api/src/slack/slack-token-redaction.ts`.
   */
  SLACK_BOT_TOKEN: z.string().min(1, 'must not be empty').optional(),

  /** The channel the freed-spot notice and the daily summary are posted to. */
  SLACK_CHANNEL_ID: z.string().min(1, 'must not be empty').optional(),

  /** Per-attempt HTTP timeout for a Slack call. */
  SLACK_REQUEST_TIMEOUT_MS: positiveMillisecondsSchema.default(
    ENV_DEFAULTS.SLACK_REQUEST_TIMEOUT_MS
  ),
  /** Total attempts per Slack call, the first one included. `1` disables retrying. */
  SLACK_RETRY_ATTEMPTS: positiveCountSchema.default(ENV_DEFAULTS.SLACK_RETRY_ATTEMPTS),
  /** First backoff delay; each further attempt doubles it (500 → 1000 → 2000 …). */
  SLACK_RETRY_BASE_DELAY_MS: positiveMillisecondsSchema.default(
    ENV_DEFAULTS.SLACK_RETRY_BASE_DELAY_MS
  ),

  /** When the daily summary is posted, as `HH:MM` **in Europe/Prague**. */
  SLACK_DAILY_SUMMARY_AT: timeOfDaySchema.default(ENV_DEFAULTS.SLACK_DAILY_SUMMARY_AT),
});

/**
 * `SLACK_ENABLED=true` without a token or a channel is a misconfiguration that
 * would otherwise only show up as a failed API call per notification, hours
 * later, in a log nobody is reading. Checked here so it crashes the boot
 * instead — naming both variables, and neither of their values.
 */
export const apiEnvSchema = apiEnvObjectSchema.superRefine((env, ctx) => {
  if (!env.SLACK_ENABLED) {
    return;
  }
  for (const key of ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID'] as const) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'is required when SLACK_ENABLED=true',
      });
    }
  }
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/**
 * Formats a `ZodError` into a multi-line, human-readable message that names
 * every offending variable and states what is wrong with it. It never
 * includes the invalid value itself: Zod's own issue messages for the checks
 * used in this schema (missing/empty, wrong type, bad enum member, bad URL,
 * out-of-range number) describe the *expectation*, not the input — so this
 * formatter is safe to print to logs or a terminal that other people can see.
 */
function formatEnvValidationError(appName: string, error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const variable = issue.path.join('.') || '(root)';
    return `  - ${variable}: ${issue.message}`;
  });
  return [
    `Invalid or missing environment variables for ${appName}. Fix these and restart:`,
    ...lines,
  ].join('\n');
}

/**
 * Validates `process.env` (or a stand-in, e.g. in tests) against
 * {@link apiEnvSchema}. Intended to be passed as `validate` to
 * `ConfigModule.forRoot`, whose contract is: return the validated config, or
 * throw to abort bootstrap.
 */
export function validateApiEnv(config: Record<string, unknown>): ApiEnv {
  const result = apiEnvSchema.safeParse(config);
  if (!result.success) {
    throw new Error(formatEnvValidationError('api', result.error));
  }
  return result.data;
}
