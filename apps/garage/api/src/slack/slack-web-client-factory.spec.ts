/**
 * `DefaultSlackWebClientFactory` — the only shipped `WebClient` construction,
 * and the one nothing else in this file set exercised.
 *
 * Every other Slack spec builds its *own* factory, hand-copying the same four
 * options (`timeout`, `retryConfig`, `rejectRateLimitedCalls`,
 * `attachOriginalToWebAPIRequestError`) to point the real SDK at a local test
 * server. That is the right shape for testing `SlackClient`'s retry and
 * redaction behaviour honestly, but it means the *shipped* factory — the one
 * that actually runs in production — was asserted only by
 * `slack.module.spec.ts`'s "constructs a `WebClient` in exactly one shipped
 * file", which checks that the call exists, not what it is called with.
 * Flipping `retryConfig`, `rejectRateLimitedCalls` and
 * `attachOriginalToWebAPIRequestError` all at once left every other Slack test
 * green (task-16-task-review.md, finding I2).
 *
 * This file mocks the SDK's `WebClient` constructor directly, so it can assert
 * the shipped factory's actual call — the option object a maintainer would
 * have to touch to weaken any of the three safety properties
 * `doc/slack.md` §5.1 and the class comment on `DefaultSlackWebClientFactory`
 * describe.
 */

jest.mock('@slack/web-api', () => ({ WebClient: jest.fn() }));

import { WebClient } from '@slack/web-api';
import { DefaultSlackWebClientFactory } from './slack-client.service';

const MockWebClient = WebClient as unknown as jest.Mock;

describe('DefaultSlackWebClientFactory', () => {
  afterEach(() => {
    MockWebClient.mockClear();
  });

  it('constructs the SDK client with the token, no numeric timeout, and the four safety-relevant options', () => {
    new DefaultSlackWebClientFactory().create({
      token: 'xoxb-configured-token',
      signal: () => undefined,
    });

    expect(MockWebClient).toHaveBeenCalledTimes(1);
    expect(MockWebClient).toHaveBeenCalledWith('xoxb-configured-token', {
      // Not `SLACK_REQUEST_TIMEOUT_MS`: `SlackClient`'s own timer owns the
      // per-attempt timeout so it can abort the connection itself. A second,
      // axios-owned timeout here would tear it down the same way and make
      // that abort untestable — see the class comment's "The timeout".
      timeout: 0,
      // Ours, not the SDK's ten-retries-over-thirty-minutes default.
      retryConfig: { retries: 0 },
      // A 429 surfaces as `RateLimitedError` instead of the SDK sleeping
      // silently inside the call.
      rejectRateLimitedCalls: true,
      // The first line of defence against the bot token reaching a log — see
      // `./slack-token-redaction.ts`.
      attachOriginalToWebAPIRequestError: false,
      // The lever `withRetries` uses to abort a timed-out attempt before its
      // retry goes out — see the two tests below for what it actually does.
      requestInterceptor: expect.any(Function),
    });
  });

  it('passes no token through when Slack is configured with none', () => {
    new DefaultSlackWebClientFactory().create({
      token: undefined,
      signal: () => undefined,
    });

    expect(MockWebClient).toHaveBeenCalledWith(undefined, expect.objectContaining({ timeout: 0 }));
  });

  /**
   * The interceptor is the one part of this factory's wiring that cannot be
   * checked by asserting the options object passed to `WebClient` — it is a
   * closure. `task-16-task-review.md`'s I2 was exactly this shape: an option
   * present but never exercised. These two tests call it the way axios would,
   * with a `signal()` that changes between calls, the way `withRetries` changes
   * `currentAttempt` between attempts.
   */
  it('attaches the current attempt signal to an outgoing request', () => {
    const controller = new AbortController();
    let current: AbortSignal | undefined = controller.signal;
    new DefaultSlackWebClientFactory().create({
      token: 'xoxb-configured-token',
      signal: () => current,
    });
    const requestInterceptor = MockWebClient.mock.calls[0]?.[1]?.requestInterceptor as (
      config: Record<string, unknown>
    ) => Record<string, unknown>;

    const configured = requestInterceptor({ url: 'https://slack.com/api/chat.postMessage' });

    expect(configured['signal']).toBe(controller.signal);
    current = undefined;
  });

  it('leaves the request config untouched between attempts, when there is no current signal', () => {
    new DefaultSlackWebClientFactory().create({
      token: 'xoxb-configured-token',
      signal: () => undefined,
    });
    const requestInterceptor = MockWebClient.mock.calls[0]?.[1]?.requestInterceptor as (
      config: Record<string, unknown>
    ) => Record<string, unknown>;

    const configured = requestInterceptor({ url: 'https://slack.com/api/chat.postMessage' });

    expect(configured['signal']).toBeUndefined();
  });
});
