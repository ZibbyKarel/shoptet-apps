/**
 * "Does this user id name a real, active account?" — the one check three
 * call sites make identically before letting an admin name somebody else as
 * a reservation holder or waitlist target: `ReservationsService.create`,
 * `WaitlistService.join`, and `BulkReservationService.resolveHolder`.
 *
 * A real check, not a constraint's job: the foreign keys on `Reservation`
 * and `WaitlistEntry` would only say `CONFLICT` for a nonexistent id, and an
 * admin who mistyped one deserves `NOT_FOUND` instead. All three call sites
 * happen to run it outside their transaction, against `PrismaService.client`
 * — a lookup, not an invariant, the same reasoning `ReservationsService
 * .create`'s neighbouring spot lookup uses. It is still typed as
 * `Prisma.TransactionClient` rather than the concrete `PrismaClient`, so a
 * future caller that does need it inside a transaction can pass `tx`
 * directly — `PrismaClient` satisfies that narrower type structurally, which
 * is why passing `this.prisma.client` still type-checks. See
 * `monthly-reservation-cap.ts` for the same client-as-parameter shape.
 */

import type { Prisma } from '@garage/database';
import { DomainError } from '../common/errors/domain-error';

/**
 * Throws `DomainError('NOT_FOUND')` unless `userId` names an active user.
 */
export async function assertActiveUser(
  client: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  const target = await client.user.findFirst({
    where: { id: userId, active: true },
    select: { id: true },
  });
  if (target === null) {
    throw new DomainError('NOT_FOUND', { message: 'No such active user.' });
  }
}
