/**
 * The only place in this application that talks to Slack.
 *
 * Everything the rest of the codebase needs from Slack is two calls —
 * `chat.postMessage` and `users.lookupByEmail` — and this class is the whole
 * surface. That isolation is what `plan.md`'s scope boundary is for:
 * **outbound only**. There is no Slack request handler anywhere in `apps/garage/api`,
 * no slash command, no interactive Block Kit, no signature verification, no
 * `POST /slack/*` route — because nothing from Slack is ever accepted. A
 * reviewer can confirm that by grepping for `@slack/web-api`: this file is the
 * only hit outside a spec.
 *
 * ## Four things this class owns, and why each is here rather than at the call site
 *
 * **The enabled gate.** `SLACK_ENABLED=false` stops the call *here* — in
 * {@link SlackClient.postToChannel}, {@link SlackClient.postDirectMessage} and
 * {@link SlackClient.lookupUserIdByEmail} — and nowhere else. Every caller
 * therefore runs its full path — read the data, render the Czech copy, hand it over — whether Slack is
 * on or off, so a message that would crash while being built crashes in
 * development too. There is deliberately no `NODE_ENV` check and no
 * "pretend to send" flag: `doc/decision/0130-*` explains why the difference
 * between a developer's laptop and production is an env *value*.
 *
 * **The timeout.** A Slack call is made after a database transaction has
 * committed, on the way out of a request. Without a timeout, a Slack outage
 * that accepts connections and never answers would hold a Node socket per
 * cancellation for however long the OS keeps it. `SLACK_REQUEST_TIMEOUT_MS` is
 * per attempt, and it is **ours**, not the SDK's: `DefaultSlackWebClientFactory`
 * passes axios `timeout: 0` (no limit) on purpose, and `withRetries` races
 * every attempt against its own timer instead. A `WebClient`-internal timeout
 * would tear the connection down through the exact same mechanism the line
 * below does — indistinguishable from it, and so nothing a test could tell
 * apart from a version that forgot the abort entirely.
 *
 * **The retry.** The SDK's own retry policy is switched off
 * (`retryConfig: { retries: 0 }`) so that the backoff is ours and is testable:
 * ten retries over thirty minutes, the SDK's default, is not a policy anybody
 * chose here, and it would keep a request's Slack call alive long after the
 * response was sent. What is retried and what is not comes from
 * `describeSlackFailure` — Slack's own `{"ok": false}` answers are *not*
 * retried, because they are configuration, not weather.
 *
 * **The abort.** A timeout means "no answer *yet*", not "no request in
 * flight". Deciding an attempt has failed and letting its HTTP request keep
 * running is how a slow-but-successful response gets delivered twice: once
 * for the attempt that timed out, once for the retry. The instant `withRetries`'
 * own timer — not axios's, see above — fires, it aborts that attempt's
 * `AbortController`, wired into the `WebClient`'s axios instance via
 * `requestInterceptor` (see {@link DefaultSlackWebClientFactory}), *before*
 * classifying the failure or sleeping the backoff, so the abort always reaches
 * the connection before the retry goes out. `doc/slack.md` §4 spells out
 * exactly what guarantee this does and does not buy: at-least-once, with the
 * loser of the race torn down the moment it is known to have lost, not
 * exactly-once — a request that had already reached Slack and been accepted
 * before our timer fired is not something an abort sent afterwards can undo.
 *
 * **The redaction.** See `./slack-token-redaction.ts`. No raw Slack error ever
 * reaches the logger from this class.
 *
 * ## What it does not own
 *
 * It never throws. A Slack failure must never turn a committed cancellation
 * into an error a user sees, and the only way to guarantee that at every call
 * site is for there to be nothing to catch. Callers get a
 * {@link SlackDeliveryOutcome} instead, which is also what makes "the domain
 * operation still succeeds" testable without reading logs.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { ErrorCode, WebClient } from '@slack/web-api';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { describeSlackFailure } from './slack-failure';
import { SlackConfig } from './slack.config';
import { createSlackTokenRedactor } from './slack-token-redaction';

/** What happened to one outbound Slack call. */
export type SlackDeliveryOutcome =
  /** Slack accepted it. */
  | 'delivered'
  /** `SLACK_ENABLED=false`: nothing was sent, and that is not a failure. */
  | 'disabled'
  /** Every attempt failed. Logged; the caller carries on regardless. */
  | 'failed';

/**
 * Test seam for {@link SlackClient}'s `WebClient`.
 *
 * Overridden by the client spec so it can point the **real** `WebClient` at a
 * local HTTP server: Slack answers an application error with `200 OK` and
 * `{"ok": false, …}`, and only the real SDK turns that into the rejection this
 * class branches on. A hand-written double that rejects would be a test of the
 * double.
 *
 * `signal` is read once per outgoing HTTP call, not once per `WebClient`: it
 * is a getter, not a value, so a factory can wire it into an axios
 * `requestInterceptor` and have it pick up whichever `AbortController`
 * {@link SlackClient.withRetries} is currently attempting with. There is
 * deliberately no `timeoutMs` here any more: the timeout is `SlackClient`'s
 * own timer (see the class comment's "The timeout"), not something a
 * `WebClient` needs telling.
 */
export abstract class SlackWebClientFactory {
  abstract create(options: {
    token?: string | undefined;
    signal: () => AbortSignal | undefined;
  }): WebClient;
}

/** How the running application builds its `WebClient`. */
export class DefaultSlackWebClientFactory extends SlackWebClientFactory {
  create({
    token,
    signal,
  }: {
    token?: string | undefined;
    signal: () => AbortSignal | undefined;
  }): WebClient {
    return new WebClient(token, {
      // Deliberately *not* `timeoutMs`. `withRetries` races every attempt
      // against its own timer and aborts `signal` on firing — a second,
      // axios-owned timeout tearing the same connection down the same way
      // would make that abort redundant, and redundant means untestable: a
      // spec cannot fail by removing code that was never load-bearing. See
      // the class comment's "The timeout".
      timeout: 0,
      // Our backoff, not the SDK's. See the class comment.
      retryConfig: { retries: 0 },
      // Surface a 429 as a `RateLimitedError` we can honour `Retry-After` from,
      // instead of the SDK silently sleeping inside the call.
      rejectRateLimitedCalls: true,
      // The first line of defence against the token reaching a log: without
      // this, a transport failure carries the axios request — headers included
      // — on `error.original`. See `./slack-token-redaction.ts`.
      attachOriginalToWebAPIRequestError: false,
      // Gives `withRetries` a lever on the in-flight axios request: the
      // WebClient exposes no per-call `signal` option, but it does run this as
      // an axios request interceptor, so attaching the current attempt's
      // signal here reaches every `chat.postMessage`/`users.lookupByEmail`
      // call the same way. Read fresh on every request — see the class doc.
      requestInterceptor: (requestConfig) => {
        const current = signal();
        if (current !== undefined) {
          requestConfig.signal = current;
        }
        return requestConfig;
      },
    });
  }
}

@Injectable()
export class SlackClient {
  private readonly web: WebClient;
  private readonly redact: (value: string) => string;
  /**
   * The in-flight attempt's controller, read by the factory's
   * `requestInterceptor`. Empty outside an attempt (and always, once Slack is
   * disabled and no attempt ever runs).
   *
   * **Async context, not a field.** This used to be `private currentAttempt`,
   * and `SlackClient` is a singleton: the interceptor reads it a *microtask*
   * after {@link attempt} writes it, so two overlapping calls both saw whichever
   * controller was written last. Measured against the real `@slack/web-api`,
   * both in-flight requests were handed the same signal — so a timeout aborted a
   * controller attached to nothing (its own request kept running, the duplicate
   * delivery this class exists to prevent) while tearing down a *different*
   * call that had not timed out (a genuine duplicate message, via that call's
   * retry). `SlackDomainEventPublisher.publish` detaches one un-awaited chain
   * per event, so two overlapping cancellations reach this. An
   * `AsyncLocalStorage` store survives the interceptor's microtask hop and is
   * per call by construction. See `doc/decision/0237-*`.
   */
  private readonly inFlight = new AsyncLocalStorage<AbortController>();

  constructor(
    private readonly config: SlackConfig,
    @InjectPinoLogger(SlackClient.name) private readonly logger: PinoLogger,
    webClientFactory: SlackWebClientFactory
  ) {
    this.redact = createSlackTokenRedactor(config.target?.botToken);
    // Built even when disabled. Constructing a `WebClient` opens no connection,
    // and building it unconditionally keeps one code path instead of two.
    this.web = webClientFactory.create({
      token: config.target?.botToken,
      signal: () => this.inFlight.getStore()?.signal,
    });
  }

  /** Whether calls leave the process. Read by the daily job for its log line. */
  get enabled(): boolean {
    return this.config.target !== undefined;
  }

  /** Posts to the configured shared channel. Never throws. */
  async postToChannel(text: string): Promise<SlackDeliveryOutcome> {
    const target = this.config.target;
    if (target === undefined) {
      return this.notSent();
    }
    return this.post(target.channelId, text);
  }

  /**
   * Posts a direct message to one Slack user. Never throws.
   *
   * `chat.postMessage` with a user id as the channel is the documented way to
   * DM as a bot — Slack opens the conversation itself — so there is no
   * `conversations.open` call here and no second permission to grant.
   */
  async postDirectMessage(slackUserId: string, text: string): Promise<SlackDeliveryOutcome> {
    if (this.config.target === undefined) {
      return this.notSent();
    }
    return this.post(slackUserId, text);
  }

  private async post(channel: string, text: string): Promise<SlackDeliveryOutcome> {
    const succeeded = await this.withRetries('chat.postMessage', { channel }, async () => {
      await this.web.chat.postMessage({ channel, text });
    });
    return succeeded ? 'delivered' : 'failed';
  }

  /**
   * The disabled path. `debug`, not `info`: with Slack off this fires on every
   * cancellation, and an operator who turned it off does not need telling each
   * time. Nothing about it is conditional on `NODE_ENV`.
   */
  private notSent(): SlackDeliveryOutcome {
    this.logger.debug('Slack disabled; message not sent');
    return 'disabled';
  }

  /**
   * Resolves a Slack user id from an email address, for a direct message.
   *
   * Returns `undefined` when Slack is disabled, when the lookup fails, and when
   * Slack answers `users_not_found` — three different situations that a caller
   * treats identically (there is nobody to message), and that are distinguished
   * in the log rather than in the type.
   */
  async lookupUserIdByEmail(email: string): Promise<string | undefined> {
    if (this.config.target === undefined) {
      this.logger.debug('Slack disabled; user lookup skipped');
      return undefined;
    }

    let userId: string | undefined;
    // The email is deliberately not in the log context: it is the one piece of
    // personal data this call carries, and the reservation id already in the
    // caller's line identifies the person for anyone who needs to.
    await this.withRetries('users.lookupByEmail', {}, async () => {
      const result = await this.web.users.lookupByEmail({ email });
      userId = result.user?.id;
    });
    return userId;
  }

  /**
   * Runs `call` up to `SLACK_RETRY_ATTEMPTS` times. Returns whether it
   * eventually succeeded; never throws.
   *
   * @param context Extra fields for the log line. Must contain no credential
   *   and no personal data — everything passed here is written to stdout.
   */
  private async withRetries(
    operation: string,
    context: Record<string, unknown>,
    call: () => Promise<void>
  ): Promise<boolean> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.attempt(call);
        return true;
      } catch (error) {
        const failure = describeSlackFailure(error, this.redact);
        const lastAttempt = attempt >= this.config.retryAttempts;

        if (!failure.retryable || lastAttempt) {
          // Note what is *not* here: no `err`. A Slack error can transitively
          // carry the bot token, and pino's error serializer copies own
          // properties. `failure` is scalars only, already redacted.
          this.logger.error(
            { ...context, ...failure, operation, attempt, retryable: failure.retryable },
            'Slack call failed'
          );
          return false;
        }

        const delayMs = failure.retryAfterMs ?? this.backoffMs(attempt);
        this.logger.warn(
          { ...context, ...failure, operation, attempt, delayMs },
          'Slack call failed; retrying'
        );
        await sleep(delayMs);
      }
    }
  }

  /**
   * Runs one attempt of `call`, racing it against `SLACK_REQUEST_TIMEOUT_MS`.
   *
   * This is the abort described in the class comment. `call()`'s own HTTP
   * request is given a fresh `AbortController`, published on {@link inFlight}
   * for the duration of *this* attempt only, and the *instant* our timer —
   * never axios's; that one is disabled, see `DefaultSlackWebClientFactory` —
   * decides the attempt is late, `controller.abort()` runs before the rejection
   * this method throws even reaches `withRetries`'s `catch`. There is no window
   * in this method in which an attempt is known to have timed out but has not
   * yet been aborted.
   *
   * That guarantee is per *call*, not per process, and that is the point of the
   * `AsyncLocalStorage`: `call()` is started inside `inFlight.run`, so every
   * request it makes — the interceptor included, a microtask later — reads this
   * attempt's controller and no other's. Two concurrent callers therefore abort
   * strictly their own connections. See {@link inFlight}.
   *
   * The synthetic error on timeout carries `code: ErrorCode.RequestError` so
   * `describeSlackFailure` classifies it exactly as it would classify axios's
   * own timeout error: retryable, logged as `slack_webapi_request_error`.
   */
  private attempt(call: () => Promise<void>): Promise<void> {
    const controller = new AbortController();

    return this.inFlight.run(
      controller,
      () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            controller.abort();
            reject(
              Object.assign(
                new Error(`Slack request timed out after ${this.config.requestTimeoutMs}ms`),
                {
                  code: ErrorCode.RequestError,
                }
              )
            );
          }, this.config.requestTimeoutMs);

          call().then(
            () => {
              clearTimeout(timer);
              resolve();
            },
            (error: unknown) => {
              clearTimeout(timer);
              reject(error);
            }
          );
        })
    );
  }

  /** Exponential: base, 2×base, 4×base … for attempts 1, 2, 3 … */
  private backoffMs(attempt: number): number {
    return this.config.retryBaseDelayMs * 2 ** (attempt - 1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
