/**
 * A diagnostic recorder for the sign-out race (Task 33, `doc/decision/0189-*`).
 *
 * `0189` was missing exactly one datum: the request `Cookie` header on the
 * `GET /` that came back signed in. Playwright's own trace records response
 * headers only, so this attaches to the page and writes both directions, in
 * order, to a JSONL file.
 *
 * ## Nothing here may ever hold a token
 *
 * Cookie and `Set-Cookie` **values are never written**. What is recorded is
 * the *presence* of a cookie, its *name*, its byte *length*, and an 8-hex-char
 * prefix of the SHA-256 of the value. The digest is one-way and truncated to
 * 32 bits — it cannot be turned back into a JWT, and it is not a credential —
 * but it is enough to answer the question the whole diagnosis turns on:
 * *is the cookie on this request the same one the previous response set, or a
 * different one?* Without it, "a cookie was present" cannot be told apart from
 * "a different cookie was present".
 *
 * Enabled only when `E2E_AUTH_LOG_DIR` is set, so a normal suite run pays
 * nothing and leaves no artifact behind.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Request, Response } from '@playwright/test';

/** Auth.js's session cookie under a plain-HTTP origin. */
export const SESSION_COOKIE = 'authjs.session-token';

/**
 * A one-way, truncated digest of a cookie value.
 *
 * Eight hex characters of SHA-256: enough to distinguish two tokens, far too
 * little to be one. Returned as `'-'` for an empty value, which is what a
 * deletion looks like.
 */
function shape(value: string): string {
  if (value === '') return '-';
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

interface CookieShape {
  readonly name: string;
  readonly len: number;
  readonly sha8: string;
}

/** Parses a request `Cookie` header into names and shapes. Values are dropped. */
function parseCookieHeader(header: string | undefined): CookieShape[] {
  if (header === undefined || header === '') return [];
  return header
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair !== '')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const name = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? '' : pair.slice(eq + 1);
      return { name, len: value.length, sha8: shape(value) };
    });
}

/**
 * A URL reduced to what a diagnosis needs: origin, path, and the *names* of the
 * query parameters.
 *
 * Values are dropped without exception. `/api/auth/callback/okta` carries the
 * OAuth2 `code` and the encrypted `state` in its query string, and an
 * authorization code is a credential — writing one into a retained debug
 * artifact would be the same mistake as logging the session token. The names
 * alone are enough to tell an RSC prefetch (`?_rsc=…`) from a plain navigation,
 * which is the only thing the ordering question turns on.
 */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const names = [...new Set([...url.searchParams.keys()])].sort();
    return `${url.origin}${url.pathname}${names.length === 0 ? '' : `?${names.join('&')}`}`;
  } catch {
    return '<unparseable url>';
  }
}

interface SetCookieShape extends CookieShape {
  /** `Max-Age=0` or an epoch `Expires` — the signature of a deletion. */
  readonly cleared: boolean;
}

/** Parses one `Set-Cookie` response header. The value never leaves this function. */
function parseSetCookie(raw: string): SetCookieShape {
  const [assignment = '', ...attributes] = raw.split(';');
  const eq = assignment.indexOf('=');
  const name = eq === -1 ? assignment.trim() : assignment.slice(0, eq).trim();
  const value = eq === -1 ? '' : assignment.slice(eq + 1);
  const cleared =
    value === '' ||
    attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/iu.test(attribute)) ||
    attributes.some((attribute) => /^\s*expires\s*=\s*Thu,\s*01 Jan 1970/iu.test(attribute));
  return { name, len: value.length, sha8: shape(value), cleared };
}

/**
 * Starts recording auth-relevant traffic for one page.
 *
 * Returns a no-op when `E2E_AUTH_LOG_DIR` is unset, so callers need no branch.
 */
export function recordAuthTraffic(page: Page, label: string): void {
  const dir = process.env['E2E_AUTH_LOG_DIR'];
  if (dir === undefined || dir === '') return;

  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${label}-${process.pid}-${Date.now()}.jsonl`);
  const started = Date.now();
  const write = (entry: Record<string, unknown>): void => {
    appendFileSync(file, `${JSON.stringify({ ms: Date.now() - started, ...entry })}\n`);
  };

  page.on('request', (request: Request) => {
    void (async () => {
      try {
        const headers = await request.allHeaders();
        write({
          dir: '>',
          method: request.method(),
          url: redactUrl(request.url()),
          resourceType: request.resourceType(),
          cookies: parseCookieHeader(headers['cookie']),
        });
      } catch {
        // A request that was torn down by a navigation cannot report its
        // headers. Losing one such line is preferable to failing the run.
      }
    })();
  });

  page.on('response', (response: Response) => {
    void (async () => {
      try {
        const setCookies = (await response.headersArray())
          .filter((header) => header.name.toLowerCase() === 'set-cookie')
          .flatMap((header) => header.value.split('\n'))
          .map(parseSetCookie);
        write({
          dir: '<',
          status: response.status(),
          url: redactUrl(response.url()),
          setCookies,
        });
      } catch {
        // Same as above.
      }
    })();
  });
}
