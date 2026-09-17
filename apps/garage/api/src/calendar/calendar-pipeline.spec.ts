/**
 * The ICS feed through the **assembled** application, over real HTTP.
 *
 * Everything worth asserting about this endpoint is a property of the
 * composition and invisible to a test that calls the controller method:
 *
 * - **The route shape.** `GET /api/calendar/:icsToken.ics` relies on Express's
 *   path parser splitting a parameter from a literal `.ics` suffix. That is a
 *   claim about `path-to-regexp`, not about our code, and the only honest way
 *   to check it is to send the URL.
 * - **`@Public()` on a globally-guarded application.** `JwtAuthGuard` is an
 *   `APP_GUARD`; whether the opt-out actually fires depends on the decorator
 *   reaching the route the request lands on.
 * - **The bytes.** The consumer is a calendar client, so the response body is
 *   parsed back with `ical.js` — an independent RFC 5545 implementation — and
 *   never compared against a string this file wrote.
 * - **The 404 being indistinguishable.** Status, body *and headers* of a bad
 *   token are compared against a path that matches no route at all. Headers are
 *   where this was nearly got wrong: `@Header()` decorators are applied before
 *   the handler runs, so they would have leaked `Content-Type: text/calendar`
 *   onto every rejection.
 *
 * The database is `PrismaDouble` and the issuer is the in-process OIDC server,
 * exactly as `orpc-pipeline.spec.ts` does it — what is under test is the
 * composition, not the storage.
 */

import type { AddressInfo } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpRequest } from 'node:http';
import ICAL from 'ical.js';
import { buildIcsFeedPath } from '@garage/contract';
import { ICS_CALENDAR_NAME, buildReservationCalendar, icsEventUid } from '@garage/calendar-export';
import type { OidcTestIssuer, TestSigningKey } from '../auth/testing/oidc-test-issuer';
import { createSigningKey, startOidcTestIssuer } from '../auth/testing/oidc-test-issuer';
import { PrismaDouble } from '../testing/prisma-double';
import type { ApiTestApp } from '../testing/nest-test-app';
import { startApiTestApp } from '../testing/nest-test-app';
import {
  CALENDAR_CACHE_CONTROL,
  CALENDAR_CONTENT_TYPE,
  CALENDAR_FILENAME,
} from './calendar.controller';

/** Shaped like the real thing: 32 bytes of `randomBytes`, base64url. */
const VALID_TOKEN = 'aG93ZXZlci1sb25nLXRoaXMtaXMtaXQtaXMtb3BhcXVl';
const UNKNOWN_TOKEN = 'bm90LWEtdG9rZW4tYnV0LXRoZS1zYW1lLXNoYXBlLXh4';
const OFFBOARDED_TOKEN = 'b2ZmYm9hcmRlZC1idXQtc3RpbGwtaG9sZGluZy1hLXVybA';

interface FeedResponse {
  status: number;
  headers: Headers;
  body: string;
}

describe('the ICS feed through the assembled application', () => {
  let harness: ApiTestApp;
  let issuer: OidcTestIssuer;
  let signingKey: TestSigningKey;
  let double: PrismaDouble;
  const originalEnv = { ...process.env };

  async function get(path: string, headers: Record<string, string> = {}): Promise<FeedResponse> {
    const response = await fetch(`${harness.baseUrl}${path}`, { headers });
    return { status: response.status, headers: response.headers, body: await response.text() };
  }

  function feed(token: string, headers?: Record<string, string>): Promise<FeedResponse> {
    return get(buildIcsFeedPath(token), headers);
  }

  function eventsOf(ics: string): InstanceType<typeof ICAL.Component>[] {
    return new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent');
  }

  /**
   * A conditional `GET`, issued with `node:http` rather than `fetch`.
   *
   * This is not fastidiousness. Node's `fetch` (undici) attaches
   * `cache-control: no-cache` **and** `pragma: no-cache` to any request that
   * carries an `if-none-match` header, and the `fresh` module Express uses
   * treats a request `cache-control: no-cache` as an explicit demand for a full
   * response — correctly, per RFC 9111 §5.2.1.4. So a `fetch`-based version of
   * the 304 test reads 200 and looks like a missing feature, while the server
   * is behaving exactly as it should. Observed by logging the headers Express
   * actually received: `{"inm":"W/\\"…\\"","cc":"no-cache","pragma":"no-cache"}`
   * from `fetch`, `{"inm":"W/\\"…\\""}` from `node:http`.
   */
  async function conditionalGet(
    path: string,
    etag: string
  ): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
    const { port } = harness.app.getHttpServer().address() as AddressInfo;
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port, path, method: 'GET', headers: { 'if-none-match': etag } },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body })
          );
        }
      );
      request.on('error', reject);
      request.end();
    });
  }

  beforeAll(async () => {
    signingKey = createSigningKey('key-1');
    issuer = await startOidcTestIssuer([signingKey]);
    double = new PrismaDouble();

    harness = await startApiTestApp({ issuer, store: double });
  });

  afterAll(async () => {
    await harness?.close();
    await issuer?.close();
    process.env = originalEnv;
  });

  beforeEach(() => {
    double.reset();
  });

  /** Seeds the holder plus one reservation on a fixed future day. */
  function seedHolderWithOneReservation(token = VALID_TOKEN): { id: string; date: string } {
    const spot = double.seedSpot({ label: 'E2.92' });
    const user = double.seedUser({ oktaId: 'okta-holder', icsToken: token });
    // Far enough ahead to stay inside the feed's horizon whenever this runs.
    const date = `${new Date().getUTCFullYear() + 1}-06-01`;
    const reservation = double.seedReservation({
      parkingSpotId: spot.id,
      userId: user.id,
      date,
      createdAt: new Date('2026-09-01T08:30:00.000Z'),
    });
    return { id: reservation.id, date };
  }

  describe('a valid token', () => {
    it('is served without any Authorization header at all', async () => {
      seedHolderWithOneReservation();

      const response = await feed(VALID_TOKEN);

      // `@Public()` really fires: no bearer token was sent, and `JwtAuthGuard`
      // is a global APP_GUARD.
      expect(response.status).toBe(200);
    });

    it('returns a document a calendar client can parse, with the expected event', async () => {
      const reservation = seedHolderWithOneReservation();

      const response = await feed(VALID_TOKEN);
      const calendar = new ICAL.Component(ICAL.parse(response.body));
      const events = calendar.getAllSubcomponents('vevent');

      expect(calendar.name).toBe('vcalendar');
      expect(calendar.getFirstPropertyValue('x-wr-calname')).toBe(ICS_CALENDAR_NAME);
      expect(events).toHaveLength(1);

      const event = new ICAL.Event(events[0]);
      expect(event.uid).toBe(icsEventUid(reservation.id));
      expect(event.summary).toBe('Parkování – E2.92');
      expect(event.location).toBe('E2.92');
      expect(event.startDate.isDate).toBe(true);
      expect(event.startDate.toString()).toBe(reservation.date);
    });

    it('carries the calendar media type and cache headers', async () => {
      seedHolderWithOneReservation();

      const response = await feed(VALID_TOKEN);

      expect(response.headers.get('content-type')).toBe(CALENDAR_CONTENT_TYPE);
      // `private` is the one that matters: the URL is the credential, so no
      // shared cache may hold the body.
      expect(response.headers.get('cache-control')).toBe(CALENDAR_CACHE_CONTROL);
      expect(response.headers.get('cache-control')).toContain('private');
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${CALENDAR_FILENAME}"`
      );
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it('is UTF-8 on the wire, so Czech copy survives the trip', async () => {
      seedHolderWithOneReservation();

      const response = await feed(VALID_TOKEN);

      // Read as bytes and decoded explicitly — a mislabelled charset would show
      // up here as mojibake even though the string comparison above passed on a
      // correctly-decoded body.
      const bytes = await fetch(`${harness.baseUrl}${buildIcsFeedPath(VALID_TOKEN)}`).then((r) =>
        r.arrayBuffer()
      );
      expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(response.body);
      expect(response.body).toContain('Parkování');
    });

    it('answers a conditional re-fetch with 304 and no body', async () => {
      seedHolderWithOneReservation();

      const first = await feed(VALID_TOKEN);
      const etag = first.headers.get('etag');
      expect(etag).not.toBeNull();

      // `node:http`, not `fetch` — see `conditionalGet`. This test read 200 for
      // an hour before that was understood, and the endpoint was never wrong.
      const second = await conditionalGet(buildIcsFeedPath(VALID_TOKEN), etag as string);

      expect(second.status).toBe(304);
      expect(second.body).toBe('');
      // A polling client is told nothing new, which is the point: no database
      // read has to be repeated for a body it already holds.
      expect(second.headers['content-length']).toBeUndefined();
    });

    it('changes its ETag when the reservations change', async () => {
      const spot = double.seedSpot({ label: 'E2.92' });
      const user = double.seedUser({ oktaId: 'okta-holder', icsToken: VALID_TOKEN });
      const date = `${new Date().getUTCFullYear() + 1}-06-01`;
      const first = await feed(VALID_TOKEN);

      double.seedReservation({ parkingSpotId: spot.id, userId: user.id, date });
      const second = await feed(VALID_TOKEN);

      expect(second.headers.get('etag')).not.toBe(first.headers.get('etag'));
      expect(eventsOf(second.body)).toHaveLength(1);
    });

    it('serves an empty but valid calendar to a user with no reservations', async () => {
      double.seedUser({ oktaId: 'okta-holder', icsToken: VALID_TOKEN });

      const response = await feed(VALID_TOKEN);

      expect(response.status).toBe(200);
      expect(eventsOf(response.body)).toHaveLength(0);
    });

    it('serves exactly what the wrapper produces for the same data', async () => {
      const reservation = seedHolderWithOneReservation();

      const response = await feed(VALID_TOKEN);

      // The controller adds nothing of its own to the body — no header line, no
      // trailing newline, no re-encoding.
      expect(response.body).toBe(
        buildReservationCalendar({
          entries: [
            {
              reservationId: reservation.id,
              date: reservation.date,
              createdAt: '2026-09-01T08:30:00.000Z',
              spotLabel: 'E2.92',
            },
          ],
        })
      );
    });
  });

  describe('a token that is not a live user’s', () => {
    /**
     * Headers a 404 may differ in without leaking anything about a token.
     *
     * `x-ratelimit-*` earns its place here rather than being waved through:
     * `remaining` counts this test's own requests and `limit` names the route's
     * throttler tier. Both are properties of *where* the request landed, not of
     * *which* token it carried — every token, live or not, decrements the same
     * counter by one and reads the same limit. That the tier is the strict one
     * is asserted positively below, rather than left as a diff nobody reads.
     */
    const VOLATILE_HEADERS = new Set([
      'date',
      'content-length',
      'etag',
      'x-request-id',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ]);

    function stableHeaders(response: FeedResponse): Record<string, string> {
      const entries: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (!VOLATILE_HEADERS.has(key)) {
          entries[key] = value;
        }
      });
      return entries;
    }

    beforeEach(() => {
      seedHolderWithOneReservation();
      double.seedUser({ oktaId: 'okta-gone', icsToken: OFFBOARDED_TOKEN, active: false });
    });

    it('answers 404 for an unknown token, not 401', async () => {
      const response = await feed(UNKNOWN_TOKEN);

      expect(response.status).toBe(404);
      // A 401 would confirm the route exists and the token was merely wrong,
      // which is the enumeration oracle `doc/decision/0080-*` removes.
      expect(response.status).not.toBe(401);
      expect(response.headers.get('www-authenticate')).toBeNull();
    });

    it('answers 404 for a deactivated user’s token — offboarding kills the feed too', async () => {
      const response = await feed(OFFBOARDED_TOKEN);

      expect(response.status).toBe(404);
      expect(response.body).not.toContain('BEGIN:VCALENDAR');
    });

    it('answers every unservable token identically — status, body and headers', async () => {
      // This is the property enumeration actually turns on: an attacker walking
      // the token space only ever sends well-formed `….ics` URLs, so what they
      // must not be able to tell apart is "no such token", "a token that is
      // real but belongs to a deactivated user", and "a token that isn't even
      // the right shape".
      const unknown = await feed(UNKNOWN_TOKEN);
      const offboarded = await feed(OFFBOARDED_TOKEN);
      const malformed = await feed('%%%-not-base64url');

      // `/api/calendar/.ics` is deliberately **not** in this set: an empty
      // token does not match the route at all, so it is a router 404 rather
      // than a rejected token. It is covered under "the URL" below.
      const responses = [unknown, offboarded, malformed];
      expect(new Set(responses.map((response) => response.status))).toEqual(new Set([404]));
      expect(new Set(responses.map((response) => response.body)).size).toBe(1);
      expect(
        new Set(responses.map((response) => JSON.stringify(stableHeaders(response)))).size
      ).toBe(1);
      expect(JSON.parse(unknown.body)).toEqual({ statusCode: 404, message: 'Not Found' });
    });

    it('gives a rejection none of the headers a served feed would carry', async () => {
      // The half that `@Header()` decorators would have leaked: they are applied
      // before the handler runs, so a bad token would have come back advertising
      // `text/calendar`, a `Cache-Control: private, …` and a
      // `Content-Disposition` — a perfect signal that the route matched.
      const unrouted = await get('/api/calendar/there-is-no-such-thing');
      const unknown = await feed(UNKNOWN_TOKEN);

      expect(stableHeaders(unknown)).toEqual(stableHeaders(unrouted));
      expect(unknown.headers.get('content-type')).toBe(unrouted.headers.get('content-type'));
      expect(unknown.headers.get('content-type')).toContain('application/json');
      expect(unknown.headers.get('cache-control')).toBeNull();
      expect(unknown.headers.get('content-disposition')).toBeNull();
    });

    it('differs from an unrouted path only in the framework’s own message', async () => {
      // Stated rather than hidden. Nest's router echoes the path it could not
      // match (`Cannot GET /api/calendar/nope`), while this endpoint answers a
      // constant `Not Found`, so the two bodies are not byte-identical.
      //
      // That difference reveals exactly one thing — that a URL ending in `.ics`
      // under `/api/calendar` matches a route — which is public knowledge: the
      // path is in `libs/garage/contract`, in `doc/ics.md` and on the settings screen.
      // It says nothing about any token. Closing it would mean echoing the
      // request path, i.e. reflecting somebody's *token* back into an error
      // body that may be logged by a proxy, which is a worse trade. See
      // `doc/decision/0080-*`.
      const unrouted = await get('/api/calendar/there-is-no-such-thing');
      const unknown = await feed(UNKNOWN_TOKEN);

      expect(JSON.parse(unrouted.body)).toEqual({
        statusCode: 404,
        message: 'Cannot GET /api/calendar/there-is-no-such-thing',
      });
      expect(JSON.parse(unknown.body)).toEqual({ statusCode: 404, message: 'Not Found' });
      // And the constant body is what every token gets, valid-shaped or not.
      expect(unknown.body).not.toContain(UNKNOWN_TOKEN);
    });

    it('leaks nothing about the token in the body', async () => {
      const response = await feed(UNKNOWN_TOKEN);

      expect(response.body).not.toContain(UNKNOWN_TOKEN);
      expect(response.body.toLowerCase()).not.toContain('token');
      // No stack, ever, on a public endpoint.
      expect(response.body).not.toContain('at ');
    });
  });

  describe('token regeneration', () => {
    it('makes the old URL stop working while the new one serves the same events', async () => {
      // `me.regenerateIcsToken` is Task 12's; what is checked here is the
      // consequence at the feed, which is the half nobody had exercised.
      const reservation = seedHolderWithOneReservation();
      const before = await feed(VALID_TOKEN);
      expect(before.status).toBe(200);

      const regenerated = 'cmVnZW5lcmF0ZWQtdG9rZW4tb2YtdGhlLXNhbWUtc2hhcGU';
      const holder = double.users.find((user) => user.icsToken === VALID_TOKEN);
      await double.asPrismaService().client.user.update({
        where: { id: holder?.id ?? '' },
        data: { icsToken: regenerated },
      });

      const stale = await feed(VALID_TOKEN);
      const fresh = await feed(regenerated);

      expect(stale.status).toBe(404);
      expect(fresh.status).toBe(200);
      const event = new ICAL.Event(eventsOf(fresh.body)[0]);
      // The UID is the reservation's, not the token's, so a subscriber who
      // re-subscribes does not get a duplicate of every event.
      expect(event.uid).toBe(icsEventUid(reservation.id));
    });
  });

  describe('the stricter rate limit', () => {
    /**
     * A second application, so the throttler's in-memory counters start at zero
     * — the feed route has already been hit a dozen times by the tests above,
     * and a limit of 2 would otherwise be spent before this block began.
     *
     * The strict limit itself is set on `process.env` rather than at boot,
     * which is the documented behaviour of `StrictThrottle()`: a decorator
     * cannot inject `ConfigService`, so it resolves `ttl`/`limit` **per
     * request** (`common/throttling/throttle-tiers.ts`). That this works is
     * itself part of what the first test below shows.
     */
    let strictHarness: ApiTestApp;
    let strictDouble: PrismaDouble;

    beforeAll(async () => {
      strictDouble = new PrismaDouble();
      // The outer issuer is reused rather than a second one started: this app
      // exists for the throttler's counters, and the feed route is `@Public()`,
      // so no token is minted against it at all.
      //
      // No `jest.resetModules()`: re-importing `@nestjs/core` gives Nest two
      // copies of `Reflector` and every module fails to resolve `ThrottlerGuard`.
      // A fresh testing module is enough — `ConfigModule.forRoot` re-validates
      // `process.env` and the throttler factory re-reads it.
      strictHarness = await startApiTestApp({
        issuer,
        store: strictDouble,
        env: { THROTTLE_STRICT_LIMIT: '2' },
      });

      const spot = strictDouble.seedSpot({ label: 'E2.92' });
      const user = strictDouble.seedUser({ oktaId: 'okta-holder', icsToken: VALID_TOKEN });
      strictDouble.seedReservation({
        parkingSpotId: spot.id,
        userId: user.id,
        date: `${new Date().getUTCFullYear() + 1}-06-01`,
      });
    });

    afterAll(async () => {
      await strictHarness?.close();
      Object.assign(process.env, { THROTTLE_STRICT_LIMIT: '100000' });
    });

    /** One sequential GET of the feed against the freshly-counted app. */
    async function hitFeed(): Promise<{ status: number; limit: string | null }> {
      const response = await fetch(`${strictHarness.baseUrl}${buildIcsFeedPath(VALID_TOKEN)}`);
      await response.text();
      return { status: response.status, limit: response.headers.get('x-ratelimit-limit') };
    }

    it('lets two requests through and refuses the third', async () => {
      // One test rather than two, because the assertion is about a *sequence*
      // and splitting it would make each half depend on how many requests the
      // other had already spent — which is exactly how a rate-limit test ends
      // up passing for the wrong reason.
      const first = await hitFeed();
      const second = await hitFeed();
      const third = await hitFeed();

      expect([first.status, second.status, third.status]).toEqual([200, 200, 429]);
      expect(first.limit).toBe('2');
    });

    it('does not rate-limit the rest of the API at the strict limit', async () => {
      // `@nestjs/throttler` applies every *registered* throttler to every route,
      // so the strict tier had to be an override of the single registered one
      // rather than a second registration (`doc/decision/0034-*`). This is what
      // that means in practice.
      const rpcResponse = await fetch(`${strictHarness.baseUrl}/api/rpc/spot/list`, {
        method: 'POST',
      });
      await rpcResponse.text();

      expect(rpcResponse.headers.get('x-ratelimit-limit')).toBe('100000');
    });
  });

  describe('the URL', () => {
    it('is the one the contract builds', async () => {
      seedHolderWithOneReservation();

      // Not a restatement of `buildIcsFeedPath`: this asserts the literal path
      // the controller actually serves, so the contract helper and the route
      // cannot drift apart silently.
      expect(buildIcsFeedPath(VALID_TOKEN)).toBe(`/api/calendar/${VALID_TOKEN}.ics`);
      expect((await get(`/api/calendar/${VALID_TOKEN}.ics`)).status).toBe(200);
    });

    it('requires the .ics suffix', async () => {
      seedHolderWithOneReservation();

      expect((await get(`/api/calendar/${VALID_TOKEN}`)).status).toBe(404);
    });

    it('does not expose a collection', async () => {
      seedHolderWithOneReservation();

      expect((await get('/api/calendar')).status).toBe(404);
      expect((await get('/api/calendar/')).status).toBe(404);
      expect((await get('/api/calendar/.ics')).status).toBe(404);
    });
  });
});
