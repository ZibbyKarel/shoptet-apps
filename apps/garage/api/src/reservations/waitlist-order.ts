/**
 * The one order a waitlist queue is ever read in: `createdAt` ascending, `id`
 * as the tiebreaker.
 *
 * Every reader of `WaitlistEntry` that reports or consumes a queue position —
 * `WaitlistPromotionService`'s locking read, `WaitlistService.join`'s
 * position read-back, `BulkReservationService`'s preview/confirm reads, and
 * `DayOverviewService`'s per-cell queue — has to agree on this order, because
 * the number shown on screen as "your position" is a promise about which row
 * `WaitlistPromotionService.promote` will pick next. Two independently
 * hand-written copies of the same `ORDER BY` drift silently; a shared
 * constant cannot.
 *
 * Two forms exist, not one, because Prisma's query builder cannot express
 * `SELECT … FOR UPDATE` — the promotion's locking read has to be `$queryRaw`
 * (`waitlist-promotion.service.ts`), so it needs a `Prisma.sql` fragment,
 * while every other reader uses `findMany`'s `orderBy` and needs the object
 * form. Both are written once, here, and `waitlist-order.spec.ts` pins that
 * they name the same columns in the same directions and sequence.
 */

import type { Prisma } from '@garage/database';
import { Prisma as PrismaNamespace } from '@garage/database';

/** The `orderBy` array for every `waitlistEntry.findMany` that reports a queue. */
export const WAITLIST_ORDER: Prisma.WaitlistEntryOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { id: 'asc' },
];

/** The matching `ORDER BY` fragment for the one raw-SQL reader of the queue. */
export const WAITLIST_ORDER_SQL = PrismaNamespace.sql`ORDER BY "createdAt" ASC, "id" ASC`;
