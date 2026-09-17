/**
 * Keeping the ICS token out of the log.
 *
 * `GET /api/calendar/<token>.ics` is the one route in this application whose
 * **credential is in the URL**. Everything else authenticates with a bearer
 * header, which `buildLoggerOptions` already removes. A URL, by contrast, is
 * logged by default at three separate places — `req.url` and `req.params` in
 * `nestjs-pino`'s per-request line, and `path`/`reason` in
 * `ContractExceptionFilter` — so redacting it is not one edit but a shared
 * helper applied at every site that writes a path.
 *
 * It matters more than a header would. The token never expires on its own, is
 * not scoped to one request, and reading it back gives an attacker the holder's
 * entire parking calendar for as long as it is not regenerated. It is also the
 * exact secret the feed's 404-for-everything design (`doc/decision/0080-*`)
 * exists to keep unguessable — writing it to stdout hands it over for free to
 * anyone with log access.
 *
 * ## What is redacted
 *
 * The **whole path segment** after `/api/calendar/`, not just a well-formed
 * token. A malformed request (`/api/calendar/whatever`, no `.ics`) is one
 * character away from a real token, and Nest's own 404 message for it —
 * `Cannot GET /api/calendar/whatever` — carries it too. There is no version of
 * that segment worth keeping: it is either a credential or an attempt at one.
 *
 * The match is case-insensitive because Express's router is: with the default
 * `caseSensitive: false`, `GET /API/Calendar/<token>.ics` reaches the handler
 * and is served, so a case-sensitive redaction would be a working bypass.
 */

import { ICS_FEED_BASE_PATH } from '@garage/contract';

/** What replaces the token. Recognisable in a log, and not a valid token. */
export const REDACTED_ICS_TOKEN = '[redacted]';

/** Escapes a literal for embedding in a `RegExp`. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The path prefix plus the segment that follows it. Built from the contract
 * constant rather than written out, so moving the feed moves the redaction with
 * it instead of silently disarming it.
 */
const ICS_TOKEN_IN_PATH = new RegExp(`(${escapeForRegExp(ICS_FEED_BASE_PATH)}/)[^/?#]+`, 'gi');

/**
 * Returns `value` with any ICS token in it replaced by
 * {@link REDACTED_ICS_TOKEN}.
 *
 * Safe to apply to any string that might contain a path — a URL, a bare path,
 * or an error message with one embedded. Strings without the feed's prefix come
 * back unchanged, so call sites do not need to know which requests are feeds.
 */
export function redactIcsToken(value: string): string {
  return value.replace(ICS_TOKEN_IN_PATH, `$1${REDACTED_ICS_TOKEN}`);
}
