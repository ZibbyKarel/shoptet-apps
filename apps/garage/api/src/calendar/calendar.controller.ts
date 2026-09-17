/**
 * `GET /api/calendar/:icsToken.ics` — the personal ICS feed.
 *
 * ## The one route outside the oRPC contract
 *
 * Everything else in this application is a procedure reached over the RPC
 * protocol (`doc/decision/0057-*`). This is not, and the exemption is narrow
 * and deliberate: a calendar client subscribes by pasting a URL, sends no
 * `Authorization` header, cannot be taught the `{ json, meta }` envelope, and
 * expects `text/calendar` rather than JSON. `plan.md` §Contract-first names
 * exactly this endpoint as the single exception.
 *
 * Contract-first still binds everywhere it can: the URL's shape comes from
 * `ICS_FEED_BASE_PATH` in `libs/garage/contract`, and the data handed to the renderer
 * is `IcsCalendarEntry[]`, also from the contract. Nothing here invents a shape.
 *
 * ## Authentication
 *
 * `@Public()` — there is no bearer token to check. The credential is the
 * 32-byte `randomBytes` token in the path, and `CalendarService` is what
 * resolves it. Because that makes this the one route an unauthenticated
 * stranger can reach with a payload of their choosing, it also carries
 * `@StrictThrottle()` (20 requests/minute by default, `doc/decision/0034-*`) —
 * the tier that has existed unused since Task 10 precisely for this.
 *
 * ## Why every failure is a 404, and why the headers are set late
 *
 * A 401 on a bad token and a 404 on a bad path would let somebody enumerate
 * valid tokens by response code alone. Every rejection here is therefore the
 * same 404 with the same body Nest produces for a path that matches no route at
 * all — see `doc/decision/0080-*`.
 *
 * That is also why the response headers are set **inside the handler, after the
 * lookup has succeeded**, rather than with `@Header()` decorators. Nest applies
 * `@Header()` metadata before the handler runs, so a 404 from a bad token would
 * have come back carrying `Content-Type: text/calendar`, `Cache-Control:
 * private, …` and a `Content-Disposition` — and an unrouted 404 would not. The
 * status would have matched and the headers would have given the game away.
 * `calendar-pipeline.spec.ts` compares the two responses header by header.
 */

import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ICS_FEED_BASE_PATH, ICS_FEED_FILE_EXTENSION } from '@garage/contract';
import { buildReservationCalendar } from '@garage/calendar-export';
import { Public } from '../auth/public.decorator';
import { StrictThrottle } from '../common/throttling/throttle-tiers';
import { GLOBAL_PREFIX } from '../configure-app';
import { CalendarService } from './calendar.service';

/**
 * Route prefix of this controller, i.e. {@link ICS_FEED_BASE_PATH} without the
 * global prefix that `configureApp` adds back.
 *
 * Derived from both constants rather than written out, so the contract stays
 * the single definition of where the feed lives and a change to either end is a
 * compile-time-adjacent failure rather than a silent 404.
 */
export const CALENDAR_ROUTE_PREFIX = ICS_FEED_BASE_PATH.slice(`/${GLOBAL_PREFIX}/`.length);

/**
 * The route parameter, including the literal `.ics` suffix calendar clients
 * expect. Express's path parser reads `:icsToken` up to the final `.ics`.
 */
export const CALENDAR_FEED_ROUTE = `:icsToken${ICS_FEED_FILE_EXTENSION}`;

/**
 * `Cache-Control` on a successful feed response.
 *
 * - `private` is the load-bearing word: the URL contains the user's only
 *   calendar credential, so a shared cache must never hold the response.
 * - `max-age=300` lets a client that polls in a tight loop be answered locally
 *   without another database read, while staying far below the hour the feed
 *   itself advertises as its refresh interval.
 * - `must-revalidate` forbids serving it stale afterwards; a cancelled
 *   reservation should disappear on the next poll, not eventually.
 */
export const CALENDAR_CACHE_CONTROL = 'private, max-age=300, must-revalidate';

/** Media type of an iCalendar document (RFC 5545 §8.1). */
export const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

/** Filename a browser opening the URL directly is offered. ASCII on purpose. */
export const CALENDAR_FILENAME = 'garage.ics';

@Public()
@StrictThrottle()
@Controller(CALENDAR_ROUTE_PREFIX)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /**
   * The feed itself.
   *
   * `passthrough: true` so that Nest still sends the returned string through
   * `res.send()`, which is what makes Express compute an `ETag` and answer a
   * conditional re-fetch with `304 Not Modified`. That only works because
   * `buildReservationCalendar` is a pure function of the data — see
   * `doc/decision/0081-*`.
   */
  @Get(CALENDAR_FEED_ROUTE)
  async feed(
    @Param('icsToken') icsToken: string,
    @Res({ passthrough: true }) response: Response
  ): Promise<string> {
    // Throws `NotFoundException` for an unknown token or a deactivated user,
    // before any header below is set.
    const entries = await this.calendar.feedEntriesForToken(icsToken);

    response.setHeader('Content-Type', CALENDAR_CONTENT_TYPE);
    response.setHeader('Cache-Control', CALENDAR_CACHE_CONTROL);
    response.setHeader('Content-Disposition', `attachment; filename="${CALENDAR_FILENAME}"`);
    // The URL is a secret. If one ever reaches a crawler — pasted into a
    // ticket, a wiki, a shared document — this asks it not to publish it.
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');

    return buildReservationCalendar({ entries });
  }
}
