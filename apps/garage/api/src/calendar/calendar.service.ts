/**
 * The personal ICS feed's data access.
 *
 * One method, and the shape of it is the security design: the token is the
 * whole credential, so it is resolved to a user and their reservations in a
 * **single** query pair with no branch that a caller can time or read.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import type { IcsCalendarEntry } from '@garage/contract';
import { addDays, todayInPrague } from '@garage/shared-types';
import { toDateColumn, toDateOnly } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';

/**
 * How far back the feed reaches, in days before today (Europe/Prague).
 *
 * Not zero: a calendar that drops yesterday's entry the moment midnight passes
 * looks to the person subscribed like their history is being deleted, and a
 * client that re-syncs an entry away cannot get it back. Not unbounded either —
 * the feed is re-rendered on every poll, and there is no reason to grow it
 * forever.
 *
 * There is deliberately **no forward bound**. The reservation window already
 * caps how far ahead anything can be booked (`admin.window.*`), so a second,
 * unrelated horizon here could only ever hide a reservation the user really
 * holds.
 *
 * A constant rather than an env variable: `doc/environment.md` exists for
 * values that differ between deployments, and this one does not — it is a
 * product decision about what a calendar should show, the same on every
 * instance. Changing it is a code change with a test, which is the right
 * amount of ceremony.
 */
export const ICS_FEED_PAST_DAYS = 30;

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The feed entries for the holder of `icsToken`.
   *
   * @throws `NotFoundException` when the token matches no **active** user.
   *
   * ## Why `NotFoundException` and not `UnauthorizedException`
   *
   * A 401 would tell an attacker walking the token space that a token exists
   * but was refused, which is exactly the oracle a 404 denies them. See
   * `doc/decision/0080-*`. Nothing in the message varies, either — the
   * exception is constructed with no argument, so Nest's default body
   * (`{ statusCode: 404, message: 'Not Found' }`) is byte-identical to the one
   * an unrouted path produces.
   *
   * ## Why the `active` check is in the `WHERE` clause
   *
   * A deactivated employee must not keep a working feed — offboarding is
   * `active: false` and every other route refuses them at the guard
   * (`doc/auth.md`). Folding it into the query rather than testing `user.active`
   * afterwards means an unknown token and a deactivated user's token take the
   * *same* path through the same single indexed lookup: same statement, same
   * branch, same response. A post-hoc check would have made the deactivated
   * case measurably slower, which is a distinguisher on a public URL.
   *
   * A **guest** reservation is in nobody's feed: the filter is `userId`, and a
   * guest row has none (`doc/decision/0303-*`). That is the intended outcome —
   * a guest has no calendar to subscribe with — and `calendar.db.spec.ts`
   * asserts it, so it cannot be lost to a later `where` clause.
   */
  async feedEntriesForToken(icsToken: string, now: Date = new Date()): Promise<IcsCalendarEntry[]> {
    // `findFirst` rather than `findUnique`: `icsToken` is unique, so this is
    // still an index lookup, but `findUnique` refuses a non-unique field in the
    // filter and `active` is not part of the key.
    const user = await this.prisma.client.user.findFirst({
      where: { icsToken, active: true },
      select: { id: true },
    });

    if (user === null) {
      throw new NotFoundException();
    }

    const from = addDays(todayInPrague(now), -ICS_FEED_PAST_DAYS);
    const reservations = await this.prisma.client.reservation.findMany({
      where: { userId: user.id, date: { gte: toDateColumn(from) } },
      // The label is the only thing about the spot that reaches the calendar.
      include: { parkingSpot: { select: { label: true } } },
      // Chronological, because that is how a calendar file is read when a human
      // opens it; `id` breaks the tie so the rendered bytes are stable, which
      // is what the `ETag` on this endpoint depends on.
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });

    return reservations.map((reservation) => ({
      reservationId: reservation.id,
      // `toDateOnly`, the `@db.Date` reader: the column has no time and no
      // zone, and the adapter hands it over as UTC midnight.
      //
      // Honest note, because this was probed rather than assumed: swapping in
      // `toDateOnlyInPrague` here does **not** change the answer and no test
      // catches it. Prague is UTC+1 or UTC+2 — always ahead — so UTC midnight
      // is 01:00 or 02:00 on the *same* calendar day. The two functions do
      // diverge, but only for instants that are not midnight UTC, which a
      // `@db.Date` never is. `toDateOnly` is still the right call because it
      // is the one that says what this value is; the point is that it is a
      // clarity choice here, not a bug fix.
      date: toDateOnly(reservation.date),
      createdAt: reservation.createdAt.toISOString(),
      spotLabel: reservation.parkingSpot.label,
    }));
  }
}
