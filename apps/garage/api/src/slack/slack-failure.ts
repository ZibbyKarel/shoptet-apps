/**
 * Turning a `@slack/web-api` failure into something safe to log and a decision
 * about whether to try again.
 *
 * ## Slack's protocol, which the shape of this file follows
 *
 * The Web API answers an application-level failure with **HTTP 200** and a body
 * of `{"ok": false, "error": "channel_not_found"}`. It is not an HTTP error, and
 * a test double that rejects instead of returning that body has modelled a
 * different API. `@slack/web-api` reads `ok` itself and converts it into a
 * thrown `WebAPIPlatformError` carrying `data.error` — so by the time this
 * function sees it, the 200 has become a rejection, but *which* rejection is
 * exactly the distinction that matters:
 *
 * | Slack did this | SDK throws | Retryable |
 * | --- | --- | --- |
 * | 200 `{"ok": false, "error": "channel_not_found"}` | `slack_webapi_platform_error` | **no** — the channel will not appear by trying again |
 * | 429 with `Retry-After` | `slack_webapi_rate_limited_error` | yes, after `retryAfter` seconds |
 * | 500 / 503 | `slack_webapi_http_error` | yes |
 * | 400 / 404 | `slack_webapi_http_error` | no |
 * | connection reset, timeout | `slack_webapi_request_error` | yes |
 *
 * `slack-client.service.spec.ts` produces every row of that table from a real
 * HTTP server the real `WebClient` talks to, rather than from a stub of the
 * SDK — the mapping above is the SDK's behaviour, and asserting it against a
 * double would be asserting the double.
 *
 * ## Why a projection rather than the error itself
 *
 * See `./slack-token-redaction.ts`: a Slack error can transitively carry the
 * bot token in an attached axios request config. Nothing in this file returns
 * the original error, and every string on the way out goes through the
 * redactor.
 */

import { ErrorCode } from '@slack/web-api';

/** A Slack failure, reduced to scalars that are safe to write to a log. */
export interface SlackFailure {
  /** The SDK's own error code, e.g. `slack_webapi_platform_error`. */
  readonly slackErrorCode: string;
  /** Slack's application-level error string, e.g. `channel_not_found`. */
  readonly slackError?: string | undefined;
  /** The HTTP status, when the failure was an HTTP one. */
  readonly statusCode?: number | undefined;
  /** How long Slack asked us to wait, in milliseconds. */
  readonly retryAfterMs?: number | undefined;
  /** The error's message, redacted. Never its stack, never its `original`. */
  readonly message: string;
  /** Whether trying the same call again could plausibly succeed. */
  readonly retryable: boolean;
}

/** Narrowing helper: does this look like the SDK's `CodedError`? */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function numberProp(error: unknown, key: string): number | undefined {
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

function platformErrorString(error: unknown): string | undefined {
  const data = (error as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const slackError = (data as { error?: unknown }).error;
  return typeof slackError === 'string' ? slackError : undefined;
}

/**
 * A `5xx` is the server's problem and may pass; a `4xx` other than 429 is ours
 * and will not. 429 does not normally arrive here — the client asks the SDK to
 * reject rate limits as `RateLimitedError` — but a proxy in front of Slack can
 * produce one without the SDK recognising it.
 */
function httpStatusIsRetryable(statusCode: number | undefined): boolean {
  return statusCode === undefined || statusCode >= 500 || statusCode === 429;
}

/**
 * Projects any thrown value into a {@link SlackFailure}.
 *
 * @param redact Removes the bot token from free-text (see
 *   `./slack-token-redaction.ts`). Required rather than optional so that a call
 *   site cannot forget it.
 */
export function describeSlackFailure(
  error: unknown,
  redact: (value: string) => string
): SlackFailure {
  const slackErrorCode = codeOf(error) ?? 'unknown_error';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redact(rawMessage);

  switch (slackErrorCode) {
    case ErrorCode.PlatformError:
      return {
        slackErrorCode,
        slackError: platformErrorString(error),
        message,
        // Slack answered, understood us, and said no. `channel_not_found`,
        // `not_in_channel`, `invalid_auth` and `users_not_found` are all
        // configuration, and retrying turns one wrong call into three.
        retryable: false,
      };

    case ErrorCode.RateLimitedError: {
      const retryAfterSeconds = numberProp(error, 'retryAfter');
      return {
        slackErrorCode,
        statusCode: 429,
        retryAfterMs: retryAfterSeconds === undefined ? undefined : retryAfterSeconds * 1_000,
        message,
        retryable: true,
      };
    }

    case ErrorCode.HTTPError: {
      const statusCode = numberProp(error, 'statusCode');
      return { slackErrorCode, statusCode, message, retryable: httpStatusIsRetryable(statusCode) };
    }

    case ErrorCode.RequestError:
      // No response at all: a reset connection, a DNS failure, or our own
      // per-attempt timeout firing. All three are worth one more try.
      return { slackErrorCode, message, retryable: true };

    default:
      // Something that is not a Slack error — a bug in our own code inside the
      // call, most likely. Retrying a bug just runs it again.
      return { slackErrorCode, message, retryable: false };
  }
}
