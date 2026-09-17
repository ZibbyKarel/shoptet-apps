/**
 * `SlackClient` against a real `@slack/web-api` talking real HTTP to a fake
 * Slack (`./testing/slack-test-server.ts`).
 *
 * Three things this shape buys that a mocked SDK would not:
 *
 * 1. **Slack's protocol is modelled, not asserted.** `{"ok": false}` arrives
 *    with `200 OK` and the SDK classifies it; the spec only says what the
 *    client did about it.
 * 2. **Retries are counted on the wire.** `server.requests.length` is the
 *    number of HTTP requests actually sent, which a stubbed method call count
 *    only approximates.
 * 3. **The bot token is observable.** It goes out in a header, so a spec can
 *    check it went out *and* that it never came back in a log line.
 *
 * Log assertions read **real pino output at `trace`** (see
 * `./testing/capture-logs.ts`). No spec in this file pins `LOG_LEVEL: 'fatal'`,
 * because a redaction test that cannot see the log proves nothing.
 */

import { ErrorCode, WebClient } from '@slack/web-api';
import type { CapturedLogs } from './testing/capture-logs';
import { captureLogs } from './testing/capture-logs';
import type { RecordedSlackRequest, SlackTestServer } from './testing/slack-test-server';
import { SLACK_OK, slackNotOk, startSlackTestServer } from './testing/slack-test-server';
import { SlackClient, SlackWebClientFactory } from './slack-client.service';
import type { SlackEnv } from './slack.config';
import { SlackConfig } from './slack.config';

/**
 * Keeps the `xoxb-` prefix, because that is what the redactor's shape-based
 * branch matches (`slack-token-redaction.ts`) and what the
 * `not.toContain('xoxb-')` assertion below is worth anything against — a
 * fixture without it would make that assertion pass vacuously.
 *
 * It deliberately does **not** carry the rest of a real bot token's shape
 * (`xoxb-<digits>-<digits>-<24 alphanumerics>`). One that did was committed
 * here and tripped GitHub's push protection on every push of this repo, so the
 * history was rewritten to this value. Do not "restore" a realistic-looking
 * one: the tests do not need it, and the push will be rejected again.
 */
const BOT_TOKEN = 'xoxb-fake-slack-token';
const CHANNEL = 'C0PARKING';

const BASE_ENV: SlackEnv = {
  SLACK_ENABLED: true,
  SLACK_BOT_TOKEN: BOT_TOKEN,
  SLACK_CHANNEL_ID: CHANNEL,
  SLACK_REQUEST_TIMEOUT_MS: 250,
  SLACK_RETRY_ATTEMPTS: 3,
  // Small but non-zero: the elapsed-time assertion below needs a real wait to
  // observe, and 60/120 ms keeps the suite fast.
  SLACK_RETRY_BASE_DELAY_MS: 60,
  SLACK_DAILY_SUMMARY_AT: '08:00',
};

/**
 * A per-attempt timeout that cannot fire during a test, so an assertion of
 * "exactly one request" tests the **retry policy** rather than the machine.
 *
 * Ten minutes, against a jest `testTimeout` of five seconds for this project:
 * for this timer to fire, the worker would have to be starved two orders of
 * magnitude longer than jest is willing to wait, so jest fails the test first
 * and says so. A failure of `toHaveLength(1)` under this value therefore has
 * exactly one meaning — something started retrying a response Slack had
 * already accepted.
 *
 * It costs nothing at runtime: `SlackClient.attempt` clears the timer on both
 * the resolve and the reject path, so it never holds the worker open.
 */
const TIMEOUT_THAT_CANNOT_FIRE_MS = 600_000;

describe('SlackClient', () => {
  let server: SlackTestServer;
  let logs: CapturedLogs;

  beforeEach(async () => {
    server = await startSlackTestServer();
    logs = captureLogs();
  });

  afterEach(async () => {
    await server.close();
  });

  /**
   * A client wired to the fake Slack, with `env` overriding the defaults.
   *
   * `onSignal` is handed the signal each outgoing request was actually given —
   * the one observation that distinguishes "every request has its own
   * controller" from "they all share the singleton's latest one", which no
   * amount of request counting can see.
   */
  function buildClient(
    env: Partial<SlackEnv> = {},
    onSignal?: (signal: AbortSignal | undefined) => void
  ): SlackClient {
    const config = SlackConfig.fromEnv({ ...BASE_ENV, ...env });
    const factory: SlackWebClientFactory = {
      create: ({ token, signal }) =>
        new WebClient(token, {
          slackApiUrl: server.apiUrl,
          // No numeric timeout here either — mirrors `DefaultSlackWebClientFactory`.
          // `SlackClient`'s own timer, not axios's, is what races each attempt.
          timeout: 0,
          retryConfig: { retries: 0 },
          rejectRateLimitedCalls: true,
          attachOriginalToWebAPIRequestError: false,
          // Mirrors `DefaultSlackWebClientFactory`: this is the wiring under
          // test in "does not double-post" below, and every other test in
          // this file exercises the client with it present, same as
          // production, rather than through a different, unwired path.
          requestInterceptor: (requestConfig) => {
            const current = signal();
            onSignal?.(current);
            if (current !== undefined) {
              requestConfig.signal = current;
            }
            return requestConfig;
          },
        }),
    };
    return new SlackClient(config, logs.logger, factory);
  }

  /** Log lines at one level, in order. */
  function linesAt(level: string): Record<string, unknown>[] {
    return logs.lines().filter((line) => line['level'] === level);
  }

  /**
   * The nth line at a level, or a failure naming what was there instead.
   * `noUncheckedIndexedAccess` is on, and "there was no such line" is a more
   * useful failure than "cannot read property of undefined".
   */
  function lineAt(level: string, index = 0): Record<string, unknown> {
    const lines = linesAt(level);
    const line = lines[index];
    if (line === undefined) {
      throw new Error(`No ${level} line #${index}; got ${JSON.stringify(lines)}`);
    }
    return line;
  }

  /** The nth request the SDK put on the wire, or a failure naming the count. */
  function requestAt(index: number): RecordedSlackRequest {
    const request = server.requests[index];
    if (request === undefined) {
      throw new Error(`No request #${index}; only ${server.requests.length} were sent`);
    }
    return request;
  }

  describe('SLACK_ENABLED=false', () => {
    it('sends nothing, and says so without calling it a failure', async () => {
      const client = buildClient({ SLACK_ENABLED: false, SLACK_BOT_TOKEN: undefined });

      await expect(client.postToChannel('cokoli')).resolves.toBe('disabled');
      await expect(client.postDirectMessage('U1', 'cokoli')).resolves.toBe('disabled');
      await expect(client.lookupUserIdByEmail('a@example.test')).resolves.toBeUndefined();

      // The strongest form of "no call is made": nothing reached the network.
      expect(server.requests).toHaveLength(0);
      expect(client.enabled).toBe(false);
      // Not `error`, not `warn`: turning Slack off is a choice, not a fault.
      expect(linesAt('error')).toHaveLength(0);
      expect(linesAt('warn')).toHaveLength(0);
    });
  });

  describe('a message Slack accepts', () => {
    /**
     * ## Why this does not assert "exactly one request"
     *
     * It used to, under the name "posts once", and that assertion was wrong —
     * not flaky, *wrong*: it asserted a property the code does not promise.
     * `doc/slack.md` §4 and `doc/decision/0135-*` both state the guarantee as
     * **at-least-once**, with the loser of a lost race torn down as soon as it
     * is known to have lost. This file was the one place still claiming
     * exactly-once, and it reddened the whole workspace's verification run at
     * random: two identical `chat.postMessage` calls, recorded under a
     * concurrent full-suite run, clean on rerun.
     *
     * The mechanism is irreducible from the client side. Under a starved
     * shared event loop the request can fully round-trip — server records it,
     * responds — *before* this process's own overdue timeout timer gets a
     * turn: Node's timers phase runs before the poll phase that would have
     * delivered the already-arrived response, so the client cannot tell "no
     * answer yet" from "answer already here, just not read yet". By the time
     * any abort could run, Slack has already accepted the message. Only a
     * server-side idempotency key would close it, and Slack's API offers none.
     *
     * So the assertions below say what the code actually promises, and nothing
     * is given up to get there — the three tests together are *stronger* than
     * the one they replace:
     *
     * - **Content** holds for every request that was sent, not just the first.
     *   A duplicate with the wrong channel, token or text fails here.
     * - **Benign shape**: every recorded request is byte-identical. That is
     *   what makes at-least-once tolerable for Slack in the first place, and
     *   it is the part a bare `toHaveLength(1)` never checked.
     * - **"A success is not retried"** — the real behavioural content of the
     *   old assertion — is pinned in its own test below, under a timeout that
     *   provably cannot fire, so it tests the retry policy instead of the
     *   machine's load.
     */
    it('posts the channel, the text and the bearer token, in every request it sends', async () => {
      server.respondWith(() => SLACK_OK);

      await expect(buildClient().postToChannel('Uvolnilo se místo')).resolves.toBe('delivered');

      // At-least-once: one request normally, more only if a timed-out attempt
      // had in fact already been accepted. Never zero.
      expect(server.requests.length).toBeGreaterThanOrEqual(1);
      for (const request of server.requests) {
        expect(request.method).toBe('POST');
        expect(request.url).toContain('chat.postMessage');
        expect(request.authorization).toBe(`Bearer ${BOT_TOKEN}`);
        expect(request.body).toContain(encodeURIComponent(CHANNEL));
        expect(request.body).toContain(encodeURIComponent('Uvolnilo se místo'));
        // Duplication is only tolerable because a duplicate is the *same*
        // message. A retry that differed would be a second, wrong post.
        expect(request).toEqual(requestAt(0));
      }
    });

    it('does not retry an attempt Slack accepted', async () => {
      // The claim the old `toHaveLength(1)` was really making, made
      // deterministic. Retries stay enabled (`SLACK_RETRY_ATTEMPTS` is 3 in
      // `BASE_ENV`), so a policy that retried a success would send a second
      // request; what is removed is the only thing that could *legitimately*
      // produce one — see `TIMEOUT_THAT_CANNOT_FIRE_MS`.
      server.respondWith(() => SLACK_OK);

      await expect(
        buildClient({ SLACK_REQUEST_TIMEOUT_MS: TIMEOUT_THAT_CANNOT_FIRE_MS }).postToChannel('ahoj')
      ).resolves.toBe('delivered');

      expect(server.requests).toHaveLength(1);
    });

    it('sends a byte-identical request when an attempt is retried', async () => {
      // The tolerated-duplication shape, pinned deterministically. A 503 is
      // used rather than a timeout on purpose: it makes the retry happen
      // without a wall clock anywhere in the test, and the property under test
      // — that a retry re-sends the *same* request — does not depend on which
      // failure triggered it.
      server.respondWith((attempt) =>
        attempt === 1
          ? { status: 503, body: { ok: false, error: 'service_unavailable' } }
          : SLACK_OK
      );

      await expect(buildClient().postToChannel('Uvolnilo se místo')).resolves.toBe('delivered');

      expect(server.requests).toHaveLength(2);
      expect(requestAt(1)).toEqual(requestAt(0));
    });

    it('sends a direct message to the user id it is given, not to the channel', async () => {
      server.respondWith(() => SLACK_OK);

      await expect(buildClient().postDirectMessage('U0PROMOTED', 'Máte místo')).resolves.toBe(
        'delivered'
      );

      expect(requestAt(0).body).toContain('U0PROMOTED');
      expect(requestAt(0).body).not.toContain(CHANNEL);
    });
  });

  describe("Slack's 200 OK with ok:false", () => {
    it('is a failure, is not retried, and names the Slack error in the log', async () => {
      server.respondWith(() => slackNotOk('channel_not_found'));

      await expect(buildClient().postToChannel('ahoj')).resolves.toBe('failed');

      // The whole point: Slack understood us and said no. Asking again is
      // three wrong calls instead of one.
      expect(server.requests).toHaveLength(1);
      expect(lineAt('error')).toMatchObject({
        slackErrorCode: 'slack_webapi_platform_error',
        slackError: 'channel_not_found',
        operation: 'chat.postMessage',
        retryable: false,
        attempt: 1,
      });
    });
  });

  describe('a 5xx', () => {
    it('is retried with a doubling backoff and succeeds when Slack recovers', async () => {
      // Four attempts, three delays: [60, 120, 240]. Two delays ([60, 120])
      // cannot tell doubling from `base * attempt` — both produce 60 then
      // 120 — so a third point is required to pin the growth as
      // *exponential* rather than merely increasing.
      server.respondWith((attempt) =>
        attempt < 4 ? { status: 503, body: { ok: false, error: 'service_unavailable' } } : SLACK_OK
      );

      const startedAt = Date.now();
      await expect(buildClient({ SLACK_RETRY_ATTEMPTS: 4 }).postToChannel('ahoj')).resolves.toBe(
        'delivered'
      );
      const elapsed = Date.now() - startedAt;

      expect(server.requests).toHaveLength(4);
      expect(linesAt('warn').map((line) => line['delayMs'])).toEqual([60, 120, 240]);
      // The delays were awaited, not merely logged.
      expect(elapsed).toBeGreaterThanOrEqual(420);
      expect(linesAt('error')).toHaveLength(0);
    });

    it('gives up after exactly SLACK_RETRY_ATTEMPTS requests', async () => {
      server.respondWith(() => ({ status: 500, body: { ok: false, error: 'internal_error' } }));

      await expect(buildClient({ SLACK_RETRY_ATTEMPTS: 2 }).postToChannel('ahoj')).resolves.toBe(
        'failed'
      );

      expect(server.requests).toHaveLength(2);
      expect(lineAt('error')).toMatchObject({
        slackErrorCode: 'slack_webapi_http_error',
        statusCode: 500,
        attempt: 2,
      });
    });

    it('does not retry at all when SLACK_RETRY_ATTEMPTS is 1', async () => {
      server.respondWith(() => ({ status: 500, body: { ok: false, error: 'internal_error' } }));

      await expect(buildClient({ SLACK_RETRY_ATTEMPTS: 1 }).postToChannel('ahoj')).resolves.toBe(
        'failed'
      );

      expect(server.requests).toHaveLength(1);
    });
  });

  describe('a 4xx other than 429', () => {
    // The one row of `httpStatusIsRetryable`'s table that the rest of this file
    // exercised only through a hand-built error object in `slack-failure.spec.ts`
    // — added here so the claim in `doc/slack.md` ("every row … from a real HTTP
    // server") is actually true rather than merely true of five rows out of six.
    it('is ours, not a Slack decision, and is not retried', async () => {
      server.respondWith(() => ({ status: 404, body: { ok: false, error: 'not_found' } }));

      await expect(buildClient({ SLACK_RETRY_ATTEMPTS: 3 }).postToChannel('ahoj')).resolves.toBe(
        'failed'
      );

      expect(server.requests).toHaveLength(1);
      expect(lineAt('error')).toMatchObject({
        slackErrorCode: 'slack_webapi_http_error',
        statusCode: 404,
        retryable: false,
        attempt: 1,
      });
    });
  });

  describe('a 429', () => {
    it('waits the Retry-After Slack asked for rather than our own backoff', async () => {
      server.respondWith((attempt) =>
        attempt === 1
          ? {
              status: 429,
              // Slack sends seconds. 1s is the smallest value that is
              // distinguishable from the 60 ms backoff this config would
              // otherwise have used.
              headers: { 'retry-after': '1' },
              body: { ok: false, error: 'ratelimited' },
            }
          : SLACK_OK
      );

      await expect(buildClient().postToChannel('ahoj')).resolves.toBe('delivered');

      expect(server.requests).toHaveLength(2);
      expect(lineAt('warn')).toMatchObject({
        slackErrorCode: 'slack_webapi_rate_limited_error',
        statusCode: 429,
        retryAfterMs: 1_000,
        delayMs: 1_000,
      });
    });
  });

  describe('a Slack that never answers', () => {
    it('times out per attempt instead of hanging the caller', async () => {
      server.respondWith(() => 'hang');

      const startedAt = Date.now();
      await expect(
        buildClient({ SLACK_RETRY_ATTEMPTS: 1, SLACK_REQUEST_TIMEOUT_MS: 150 }).postToChannel(
          'ahoj'
        )
      ).resolves.toBe('failed');
      const elapsed = Date.now() - startedAt;

      expect(elapsed).toBeGreaterThanOrEqual(150);
      // Generously bounded: the assertion is "it stopped", not a benchmark.
      expect(elapsed).toBeLessThan(5_000);
      expect(lineAt('error')).toMatchObject({ slackErrorCode: 'slack_webapi_request_error' });
    });
  });

  /**
   * `task-16-task-review.md`'s fix-round-2 finding: the earlier version of
   * this file's "posts once…" test looked like it proved single delivery, but
   * passed on a different defence — nothing here ever put a slow-but-eventual
   * response in the way of a retry, so a client that never aborted a timed-out
   * attempt was indistinguishable from one that did. Isolated, that gap never
   * failed; under real CPU contention sharing the fake server's event loop
   * with `SlackClient`, it produced two identical `chat.postMessage` calls
   * 13 times in 20 concurrent full-suite runs.
   *
   * A first attempt at reproducing this deterministically — `holdNextRequest`
   * pausing a *small* request's read — did not discriminate: axios's own
   * (then still enabled) numeric timeout already destroyed the connection
   * before the pause was ever released, with or without this fix's explicit
   * abort. What actually depends on the abort is below: an oversized body,
   * paired with `holdNextRequest`, that has not *finished being sent* when
   * the timeout fires — TCP flow control, not scheduling luck, is what keeps
   * it genuinely in flight, which is why removing the abort reliably turns
   * this red (see `task-16-report.md`'s round-2 section for that run).
   */
  describe('a timed-out attempt that is still in flight when the retry fires', () => {
    // Large enough to exceed a loopback socket's send *and* receive buffers
    // several times over (both are typically well under 1 MB). A server that
    // never reads therefore fills its TCP receive window, which stalls the
    // client's write at the OS level: the unsent remainder of attempt #1's
    // body genuinely never leaves the client process. That is what makes this
    // test deterministic rather than a hope about scheduling — it does not
    // depend on which side a shared, starved event loop gets to first, only on
    // TCP flow control, which every stack implements.
    const OVERSIZED_TEXT = 'x'.repeat(8 * 1024 * 1024);

    it('never lets the timed-out attempt complete on the wire once its retry has already succeeded', async () => {
      const held = server.holdNextRequest();
      server.respondWith(() => SLACK_OK);

      // A generous timeout and retry budget: under the concurrent full-suite
      // stress this test is specifically about (`task-16-report.md`'s
      // round-2 section), a tight timeout produces a *different* failure —
      // the untouched retry also missing the window — which is a fact about
      // this test's own margins under contention, not about the mechanism
      // under test. What matters here is the *relative* claim (attempt #1
      // never completes once something else has already succeeded), not the
      // absolute timing, so the budget is loose on purpose.
      const outcome = buildClient({
        SLACK_RETRY_ATTEMPTS: 6,
        SLACK_REQUEST_TIMEOUT_MS: 1_000,
        SLACK_RETRY_BASE_DELAY_MS: 50,
      }).postToChannel(OVERSIZED_TEXT);

      // Attempt #1's body cannot finish sending: the server is not reading,
      // so its receive window fills and the client's write stalls. Its
      // timeout fires, a retry (not held) sends the same oversized body to a
      // server that *is* reading, and succeeds.
      await expect(outcome).resolves.toBe('delivered');
      const requestsBeforeRelease = server.requests.length;

      // Let the server start reading again. Without an abort, attempt #1's
      // connection is still open and its write was only *stalled*, not
      // abandoned — Node keeps whatever was queued past what the OS had
      // accepted, and releasing the hold lets the rest flow through,
      // eventually completing the request and recording a second one. With
      // the abort, attempt #1 was destroyed the moment it was classified as
      // failed; there is nothing left to resume sending, so the connection
      // can only end in an error, never in `'end'`.
      held.release();
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      expect(server.requests).toHaveLength(requestsBeforeRelease);
    }, 60_000);
  });

  /**
   * The final review's api-platform I-1, and the reason it survived every test
   * above: each of them drives **one** `SlackClient` **sequentially**, and the
   * defect only exists when two calls overlap.
   *
   * `SlackClient` is a singleton, and the attempt's `AbortController` used to be
   * a mutable field on it. The `WebClient`'s `requestInterceptor` reads that
   * field when axios builds the request — a *microtask* after `attempt()` writes
   * it — so two calls started in the same tick both read whichever controller
   * was written last. Reproduced against the real `@slack/web-api` from this
   * repo's `node_modules`, the signals attached to the two in-flight requests
   * came back as `[ 'B', 'B' ]`: the first call's timeout then aborted a
   * controller attached to nothing (its own request kept running — the
   * "slow-but-successful response delivered twice" the class comment says the
   * abort exists to stop) while tearing down the *second* call's request, which
   * had not timed out, sending it round the retry loop as a genuine duplicate.
   *
   * Reachable without contrivance: `SlackDomainEventPublisher.publish` detaches
   * one un-awaited chain per event, so any two overlapping cancellations produce
   * exactly this, and the daily summary job can overlap with either.
   */
  describe('two calls in flight on the same client', () => {
    it('gives each request its own signal, so one timeout tears down only its own request', async () => {
      // Neither call is ever answered, so both are genuinely in flight when the
      // first one's timer fires — which is the moment the shared-controller bug
      // reaches across.
      server.respondWith(() => 'hang');
      const attached: (AbortSignal | undefined)[] = [];
      const client = buildClient(
        { SLACK_RETRY_ATTEMPTS: 1, SLACK_REQUEST_TIMEOUT_MS: 300 },
        (signal) => attached.push(signal)
      );

      // Started in the same tick, un-awaited — the shape
      // `SlackDomainEventPublisher.detach` produces.
      const first = client.postToChannel('první');
      const second = client.postToChannel('druhá');

      await expect(first).resolves.toBe('failed');

      // Two requests, two distinct controllers. Under the singleton field this
      // was one object twice over, and every assertion below followed from it.
      expect(attached).toHaveLength(2);
      expect(attached[0]).toBeDefined();
      expect(attached[1]).toBeDefined();
      expect(attached[0]).not.toBe(attached[1]);

      // The first call has timed out and torn its own request down. The second
      // has not timed out, so its request must still be alive: exactly one of
      // the two signals is aborted, and it is the first one's.
      expect(attached[0]?.aborted).toBe(true);
      expect(attached[1]?.aborted).toBe(false);

      // …and the second call then fails on its own timer, not on the first's.
      await expect(second).resolves.toBe('failed');
      expect(attached[1]?.aborted).toBe(true);
      expect(server.requests).toHaveLength(2);
    });
  });

  describe('users.lookupByEmail', () => {
    it('returns the Slack user id', async () => {
      server.respondWith(() => ({ status: 200, body: { ok: true, user: { id: 'U0FOUND' } } }));

      await expect(buildClient().lookupUserIdByEmail('jan@example.test')).resolves.toBe('U0FOUND');
    });

    it('returns undefined for users_not_found without retrying', async () => {
      server.respondWith(() => slackNotOk('users_not_found'));

      await expect(
        buildClient().lookupUserIdByEmail('nikdo@example.test')
      ).resolves.toBeUndefined();

      expect(server.requests).toHaveLength(1);
      expect(lineAt('error')).toMatchObject({ slackError: 'users_not_found' });
    });

    it('keeps the looked-up email out of the log', async () => {
      server.respondWith(() => slackNotOk('users_not_found'));

      await buildClient().lookupUserIdByEmail('jan.novak@example.test');

      expect(logs.raw()).not.toContain('jan.novak@example.test');
    });
  });

  /**
   * The regression this module exists to avoid. Each case drives a *different*
   * failure path, because the leak an earlier task shipped was in the error
   * object, not in the happy path.
   */
  describe('the bot token never reaches the log', () => {
    it.each([
      ['a platform error', () => slackNotOk('invalid_auth')],
      ['an HTTP 500', () => ({ status: 500, body: { ok: false, error: 'internal_error' } })],
      ['a timeout', () => 'hang' as const],
    ])('%s', async (_name, reply) => {
      server.respondWith(reply);

      await buildClient({
        SLACK_RETRY_ATTEMPTS: 1,
        SLACK_REQUEST_TIMEOUT_MS: 150,
      }).postToChannel('ahoj');

      // The request really did carry the credential …
      expect(requestAt(0).authorization).toBe(`Bearer ${BOT_TOKEN}`);
      // … and not one character of it came back out in the log.
      expect(logs.raw()).not.toContain(BOT_TOKEN);
      expect(logs.raw()).not.toContain('xoxb-');
      // A log line was written, so this is not passing by writing nothing.
      expect(linesAt('error')).toHaveLength(1);
    });

    it('is caught by the redactor SlackClient wires in, not only by what the SDK happens to omit', async () => {
      // Every case above exercises `describeSlackFailure`'s scalar projection,
      // which never carries the token *regardless of redaction* — the real
      // Slack SDK simply never puts the token into `error.message` for these
      // failure shapes, so those tests cannot see the redactor's wiring being
      // removed. This one instead makes redaction itself the only thing
      // standing between the token and the log: a fake `WebClient` whose
      // failure message *contains* the configured token, the exact shape a
      // future SDK version (or a regression in
      // `attachOriginalToWebAPIRequestError`) could produce. If
      // `SlackClient`'s constructor ever stops calling
      // `createSlackTokenRedactor`, this is the test that notices.
      const leakyChatPostMessage = (): Promise<never> =>
        Promise.reject(
          Object.assign(
            new Error(`connect ECONNREFUSED to slack.com (Authorization: Bearer ${BOT_TOKEN})`),
            { code: ErrorCode.RequestError }
          )
        );
      const leaky = { chat: { postMessage: leakyChatPostMessage } } as unknown as WebClient;
      const factory: SlackWebClientFactory = { create: () => leaky };
      const client = new SlackClient(
        SlackConfig.fromEnv({ ...BASE_ENV, SLACK_RETRY_ATTEMPTS: 1 }),
        logs.logger,
        factory
      );

      await client.postToChannel('ahoj');

      expect(logs.raw()).not.toContain(BOT_TOKEN);
      expect(linesAt('error')).toHaveLength(1);
    });
  });
});
