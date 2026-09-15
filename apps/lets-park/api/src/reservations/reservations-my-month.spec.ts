import type { AuthenticatedUser } from '../auth/authenticated-user';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaDouble } from '../testing/prisma-double';
import { ReservationWindowService } from '../reservation-window/reservation-window.service';
import { ReservationsService } from './reservations.service';
import { WaitlistPromotionService } from './waitlist-promotion.service';
import { ReservationPolicy } from './reservation-policy';
import { NoopDomainEventPublisher } from './reservation-events';

function authenticated(id: string): AuthenticatedUser {
  return {
    id,
    oktaId: `okta-${id}`,
    email: `${id}@example.test`,
    name: id,
    role: 'USER',
    active: true,
  };
}

describe('ReservationsService.myMonth', () => {
  let double: PrismaDouble;
  let reservations: ReservationsService;

  beforeEach(() => {
    double = new PrismaDouble();
    const prisma = double.asPrismaService();
    const audit = new AuditLogService(prisma);
    const window = new ReservationWindowService(prisma, audit);
    reservations = new ReservationsService(
      prisma,
      window,
      new ReservationPolicy(),
      new WaitlistPromotionService(audit),
      audit,
      new NoopDomainEventPublisher()
    );
  });

  it('returns the dates and count of the caller’s own reservations in the month', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const viewer = double.seedUser();
    double.seedReservation({ parkingSpotId: spot.id, userId: viewer.id, date: '2026-09-07' });
    double.seedReservation({ parkingSpotId: spot.id, userId: viewer.id, date: '2026-09-14' });

    const result = await reservations.myMonth({ month: '2026-09' }, authenticated(viewer.id));

    expect(result).toEqual({
      month: '2026-09',
      reservedDates: ['2026-09-07', '2026-09-14'],
      count: 2,
    });
  });

  it('does not count another user’s reservations', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const [viewer, other] = [double.seedUser(), double.seedUser()];
    double.seedReservation({ parkingSpotId: spot.id, userId: other.id, date: '2026-09-07' });

    const result = await reservations.myMonth({ month: '2026-09' }, authenticated(viewer.id));

    expect(result).toEqual({ month: '2026-09', reservedDates: [], count: 0 });
  });

  it('does not count a reservation in a different month', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const viewer = double.seedUser();
    double.seedReservation({ parkingSpotId: spot.id, userId: viewer.id, date: '2026-10-01' });

    const result = await reservations.myMonth({ month: '2026-09' }, authenticated(viewer.id));

    expect(result).toEqual({ month: '2026-09', reservedDates: [], count: 0 });
  });
});
