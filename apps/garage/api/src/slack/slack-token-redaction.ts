/**
 * Keeping the Slack bot token out of the log.
 *
 * This is the second credential in this application that a library will happily
 * write to stdout on its own, and it is worse than the first. `redact-ics-token.ts`
 * deals with a token that arrives in a URL and is scoped to one person's
 * calendar. This one is a **workspace-wide bot credential**: whoever reads it
 * out of a log can post as the app into every channel it is in, and read every
 * user's email through `users.lookupByEmail`.
 *
 * ## Where it would leak from, concretely
 *
 * `@slack/web-api` sends the token as an `Authorization: Bearer` header through
 * axios. When a request fails at the transport level the SDK wraps the axios
 * error and, with its default `attachOriginalToWebAPIRequestError: true`,
 * attaches the original as `error.original`. An axios error carries `config`,
 * and `config.headers.Authorization` is the token. pino's standard `err`
 * serializer copies an error's own enumerable properties — so a single
 * `logger.error({ err }, 'Slack call failed')` writes the bot token into the
 * log file.
 *
 * That is not hypothetical: it is the same class of defect that shipped a
 * bearer credential to the logs in four places on an earlier task, and survived
 * review because every spec pinned `LOG_LEVEL: 'fatal'` and no test ever read a
 * log line. `slack-client.service.spec.ts` reads real emitted lines through a
 * real pino instance at `trace` for exactly that reason.
 *
 * ## The two defences, in order
 *
 * 1. **Do not build the object that carries it.** `SlackClient` constructs its
 *    `WebClient` with `attachOriginalToWebAPIRequestError: false`, and never
 *    passes a raw Slack error to the logger — `describeSlackFailure` in
 *    `./slack-failure.ts` projects it down to a handful of scalar fields.
 * 2. **Scrub what is left.** Messages and stacks are still strings that a
 *    future SDK version could put a token in. {@link createSlackTokenRedactor}
 *    removes the configured token *by value*, which is the only check that
 *    cannot be defeated by a token format nobody predicted, and additionally
 *    removes anything shaped like a Slack token so that a *second*, unrelated
 *    workspace's credential in an error message does not sail through.
 *
 * Defence 1 alone would be enough today. Defence 2 exists because 1 depends on
 * a library default that a `npm update` can change.
 */

/** What replaces a token. Recognisable in a log, and not a valid token. */
export const REDACTED_SLACK_TOKEN = '[redacted]';

/**
 * Anything shaped like a Slack credential: `xoxb-`, `xoxp-`, `xoxa-`, `xoxe-`,
 * `xoxr-`, `xoxd-` (the browser/session cookie token), `xapp-`.
 * Case-insensitive, because a token pasted into a `.env` in the wrong case
 * still reaches the header verbatim and would still be a credential worth
 * hiding if it appeared in an error string.
 */
const SLACK_TOKEN_SHAPE = /\b(?:xox[abcdeoprs]|xapp)-[A-Za-z0-9-]+/gi;

/** Escapes a literal for embedding in a `RegExp`. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns a function that removes the Slack bot token from a string.
 *
 * @param token The configured token, when there is one. Passing it makes the
 *   redaction exact rather than pattern-based; omitting it (Slack disabled, so
 *   there is no token to leak) still leaves the shape-based pass in place.
 */
export function createSlackTokenRedactor(token?: string): (value: string) => string {
  const exact =
    token === undefined || token.length === 0 ? undefined : new RegExp(escapeForRegExp(token), 'g');

  return (value: string): string => {
    const withoutExact = exact === undefined ? value : value.replace(exact, REDACTED_SLACK_TOKEN);
    return withoutExact.replace(SLACK_TOKEN_SHAPE, REDACTED_SLACK_TOKEN);
  };
}
