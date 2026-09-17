/**
 * The personal ICS feed — the one endpoint that is deliberately **outside**
 * oRPC.
 *
 * Calendar clients (Outlook, Google Calendar) fetch a plain URL with no headers
 * they can be taught to send, so the feed cannot ride on the RPC transport and
 * cannot use the session cookie. It is a plain `GET` authenticated by an
 * unguessable token in the path, which is what `User.icsToken` is for.
 *
 * `plan.md` §Contract-first names this as the single exception. The contract's
 * job here is therefore not to define a procedure but to own the **shape of the
 * URL**, so that `apps/garage/api` (which serves it) and `apps/garage/web` (which shows it)
 * cannot drift apart. Regenerating the token *is* a procedure, and lives in
 * `./me`.
 *
 * Task 14 adds the second half: the **shape of what goes into the feed**. There
 * is no response schema — the response is `text/calendar`, not JSON — but the
 * data handed to `@garage/calendar-export` is domain data crossing a module
 * boundary, and contract-first applies to it for the same reason it applies to
 * everything else: `apps/garage/api` reads the rows, the calendar lib renders them, and
 * neither may hold its own private idea of what a feed entry is.
 */

import * as z from 'zod';
import { parkingSpotSchema, reservationSchema } from '../schemas/entities';

/**
 * Path segment the feed is mounted under, including the API's global prefix
 * (`app.setGlobalPrefix('api')` in `apps/garage/api/src/main.ts`).
 */
export const ICS_FEED_BASE_PATH = '/api/calendar';

/**
 * Suffix on the token. Calendar clients and proxies key off it, and some refuse
 * a subscription URL without it.
 */
export const ICS_FEED_FILE_EXTENSION = '.ics';

/**
 * Path of one user's feed, relative to the API origin:
 * `/api/calendar/<token>.ics`.
 *
 * The token is percent-encoded even though it is generated URL-safe — the
 * helper must not be the thing that breaks if the generator ever changes.
 *
 * @throws when `icsToken` is empty, which would produce a URL pointing at the
 * collection rather than at a user and is always a caller bug.
 */
export function buildIcsFeedPath(icsToken: string): string {
  if (icsToken.length === 0) {
    throw new Error('buildIcsFeedPath: icsToken must not be empty');
  }
  return `${ICS_FEED_BASE_PATH}/${encodeURIComponent(icsToken)}${ICS_FEED_FILE_EXTENSION}`;
}

/**
 * Absolute feed URL, e.g.
 * `buildIcsFeedUrl('https://parking.example.com', 'abc')` →
 * `https://parking.example.com/api/calendar/abc.ics`.
 *
 * Trailing slashes on `baseUrl` are trimmed, so both `https://host` and
 * `https://host/` produce the same URL.
 */
export function buildIcsFeedUrl(baseUrl: string, icsToken: string): string {
  if (baseUrl.length === 0) {
    throw new Error('buildIcsFeedUrl: baseUrl must not be empty');
  }
  return `${baseUrl.replace(/\/+$/, '')}${buildIcsFeedPath(icsToken)}`;
}

/**
 * One reservation, as it enters the calendar.
 *
 * Every field is `pick`ed from the entity schemas rather than restated, so a
 * change to how a reservation date or a spot label is represented reaches the
 * feed automatically and cannot drift.
 *
 * What is deliberately **absent** is as load-bearing as what is present:
 *
 * - **No `userId`.** A feed is one person's, and the token in the URL already
 *   decided whose. Carrying the id would make it possible to render somebody
 *   else's day into somebody's calendar by passing the wrong list.
 * - **No `parkingSpotId`.** Nothing in an ICS file can be clicked back to a
 *   spot; the label is what a human reads off the asphalt.
 * - **No group.** `ParkingGroup` has no Czech UI copy anywhere in the workspace
 *   (`libs/shared/i18n` is `scope:web` and the API may not reach it), and inventing
 *   one here would create a second, unreviewed copy of a user-facing string.
 *
 * `createdAt` **is** present, and is not decoration: it becomes the event's
 * `DTSTAMP`, which is what makes the rendered feed a pure function of the data
 * — see `doc/decision/0081-*`.
 */
export const icsCalendarEntrySchema = reservationSchema
  .pick({ date: true, createdAt: true })
  .extend({
    /** The reservation's own id. Becomes the stable `UID` of the event. */
    reservationId: reservationSchema.shape.id,
    /** Label painted on the spot, e.g. `E2.92`. */
    spotLabel: parkingSpotSchema.shape.label,
  });
export type IcsCalendarEntry = z.infer<typeof icsCalendarEntrySchema>;

/**
 * Everything the calendar renderer is given.
 *
 * A wrapper object rather than a bare array, because the feed grows options
 * (a name, a refresh hint) and a bare array has nowhere to put them without a
 * signature change at every call site.
 */
export const icsFeedSchema = z.object({
  entries: z.array(icsCalendarEntrySchema),
});
export type IcsFeed = z.infer<typeof icsFeedSchema>;
