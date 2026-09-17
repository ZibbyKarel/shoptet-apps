/**
 * The retry *policy*, in isolation.
 *
 * The errors here are hand-built, and that is only legitimate because
 * `slack-client.service.spec.ts` proves the real SDK produces exactly these
 * shapes from real HTTP — the `code`, `data.error`, `statusCode` and
 * `retryAfter` fields below are all read off the errors the SDK threw there.
 * This file asks a different question: given such an error, is trying again the
 * right thing to do?
 */

import { ErrorCode } from '@slack/web-api';
import { describeSlackFailure } from './slack-failure';

/** No-op stand-in where the redaction is not what is under test. */
const identity = (value: string): string => value;

function slackError(properties: Record<string, unknown>, message = 'boom'): Error {
  return Object.assign(new Error(message), properties);
}

describe('describeSlackFailure', () => {
  describe('a platform error (Slack’s 200 OK with ok:false)', () => {
    const error = slackError({
      code: ErrorCode.PlatformError,
      data: { ok: false, error: 'channel_not_found' },
    });

    it('is never retried — Slack understood the call and refused it', () => {
      expect(describeSlackFailure(error, identity)).toMatchObject({
        slackErrorCode: 'slack_webapi_platform_error',
        slackError: 'channel_not_found',
        retryable: false,
      });
    });

    it('survives a platform error with no readable data', () => {
      const withoutData = slackError({ code: ErrorCode.PlatformError });

      expect(describeSlackFailure(withoutData, identity)).toMatchObject({
        slackError: undefined,
        retryable: false,
      });
    });
  });

  describe('a rate limit', () => {
    it('is retried after the delay Slack asked for, converted to milliseconds', () => {
      const error = slackError({ code: ErrorCode.RateLimitedError, retryAfter: 30 });

      expect(describeSlackFailure(error, identity)).toMatchObject({
        statusCode: 429,
        retryAfterMs: 30_000,
        retryable: true,
      });
    });

    it('is still retried when Slack sent no Retry-After, on our own backoff', () => {
      const error = slackError({ code: ErrorCode.RateLimitedError });

      expect(describeSlackFailure(error, identity)).toMatchObject({
        retryAfterMs: undefined,
        retryable: true,
      });
    });
  });

  describe('an HTTP error', () => {
    it.each([
      [500, true],
      [502, true],
      [503, true],
      [429, true],
      [400, false],
      [401, false],
      [403, false],
      [404, false],
    ])('status %i is retryable: %s', (statusCode, retryable) => {
      const error = slackError({ code: ErrorCode.HTTPError, statusCode });

      expect(describeSlackFailure(error, identity)).toMatchObject({ statusCode, retryable });
    });

    it('retries when the status is unreadable, rather than giving up silently', () => {
      const error = slackError({ code: ErrorCode.HTTPError });

      expect(describeSlackFailure(error, identity)).toMatchObject({ retryable: true });
    });
  });

  it('retries a transport failure — a reset, a DNS failure, or our timeout', () => {
    const error = slackError({ code: ErrorCode.RequestError });

    expect(describeSlackFailure(error, identity)).toMatchObject({
      slackErrorCode: 'slack_webapi_request_error',
      retryable: true,
    });
  });

  describe('something that is not a Slack error at all', () => {
    it('is not retried: a bug in our own code just runs again', () => {
      expect(describeSlackFailure(new TypeError('x is not a function'), identity)).toMatchObject({
        slackErrorCode: 'unknown_error',
        message: 'x is not a function',
        retryable: false,
      });
    });

    it('survives a thrown non-Error', () => {
      expect(describeSlackFailure('just a string', identity)).toMatchObject({
        slackErrorCode: 'unknown_error',
        message: 'just a string',
      });
    });

    it('survives a thrown null', () => {
      expect(describeSlackFailure(null, identity)).toMatchObject({
        slackErrorCode: 'unknown_error',
        message: 'null',
      });
    });
  });

  it('puts the message through the redactor rather than copying it verbatim', () => {
    const error = slackError({ code: ErrorCode.RequestError }, 'failed with xoxb-secret');

    const failure = describeSlackFailure(error, (value) => value.replace('xoxb-secret', '[gone]'));

    expect(failure.message).toBe('failed with [gone]');
  });

  it('never carries the original error through, whatever is hung off it', () => {
    const error = slackError({
      code: ErrorCode.RequestError,
      // What the SDK attaches with its default settings: an axios error whose
      // request config holds the Authorization header.
      original: { config: { headers: { Authorization: 'Bearer xoxb-leak' } } },
    });

    const failure = describeSlackFailure(error, identity);

    expect(JSON.stringify(failure)).not.toContain('xoxb-leak');
    expect(Object.keys(failure)).not.toContain('original');
  });
});
