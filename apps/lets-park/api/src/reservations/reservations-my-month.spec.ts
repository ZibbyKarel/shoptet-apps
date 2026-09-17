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

describe('ReservationsService.userMonth', () => {
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

  it('answers about the named user, not the calling admin', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const [admin, holder] = [double.seedUser(), double.seedUser()];
    double.seedReservation({ parkingSpotId: spot.id, userId: admin.id, date: '2026-09-01' });
    double.seedReservation({ parkingSpotId: spot.id, userId: holder.id, date: '2026-09-07' });
    double.seedReservation({ parkingSpotId: spot.id, userId: holder.id, date: '2026-09-14' });

    const result = await reservations.userMonth(
      { userId: holder.id, month: '2026-09' },
      authenticated(admin.id)
    );

    expect(result).toEqual({
      month: '2026-09',
      reservedDates: ['2026-09-07', '2026-09-14'],
      count: 2,
    });
  });

  it('answers the same thing myMonth does when the named user is the caller', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const viewer = double.seedUser();
    double.seedReservation({ parkingSpotId: spot.id, userId: viewer.id, date: '2026-09-07' });

    const actor = authenticated(viewer.id);
    expect(await reservations.userMonth({ userId: viewer.id, month: '2026-09' }, actor)).toEqual(
      await reservations.myMonth({ month: '2026-09' }, actor)
    );
  });

  it('answers an empty month for a user with no reservations in it', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const [admin, holder] = [double.seedUser(), double.seedUser()];
    double.seedReservation({ parkingSpotId: spot.id, userId: holder.id, date: '2026-10-01' });

    const result = await reservations.userMonth(
      { userId: holder.id, month: '2026-09' },
      authenticated(admin.id)
    );

    expect(result).toEqual({ month: '2026-09', reservedDates: [], count: 0 });
  });

  it('answers an empty month for an id that holds nothing, rather than throwing', async () => {
    const admin = double.seedUser();

    const result = await reservations.userMonth(
      { userId: 'no-such-user', month: '2026-09' },
      authenticated(admin.id)
    );

    expect(result).toEqual({ month: '2026-09', reservedDates: [], count: 0 });
  });
});
