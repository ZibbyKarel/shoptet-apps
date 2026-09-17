/**
 * The double's own guardrails.
 *
 * `prisma-double.ts` promises in its header that it "fails loudly on anything
 * else rather than quietly returning `[]`". That promise is only worth what it
 * is tested to be: a guard that is silently dropped in a later edit looks
 * exactly like a guard that is there, right up to the day a test passes on a
 * row set the service never asked for. These are the cases that pin it.
 */
import { PrismaDouble } from './prisma-double';

describe('PrismaDouble', () => {
  let double: PrismaDouble;

  beforeEach(() => {
    double = new PrismaDouble();
  });

  describe('parkingSpot.findMany', () => {
    it('answers the filters and ordering it models', async () => {
      // Seeded so that insertion order and group-then-label order DIFFER
      // (insertion gives B1, A1; the ordering asked for gives A1, B1). A
      // fixture where the two coincide would pass whether or not the delegate
      // honours `orderBy` at all.
      double.seedSpot({ label: 'B1', group: 'SHARED' });
      double.seedSpot({ label: 'A1', group: 'IT' });
      double.seedSpot({ label: 'A2', group: 'IT', active: false });

      const rows = await double.asPrismaService().client.parkingSpot.findMany({
        where: { active: true },
        orderBy: [{ group: 'asc' }, { label: 'asc' }],
      });

      expect(rows.map((row) => row.label)).toEqual(['A1', 'B1']);
    });

    it('honours a label-only ordering rather than imposing its own', async () => {
      double.seedSpot({ label: 'B1', group: 'IT' });
      double.seedSpot({ label: 'A1', group: 'SHARED' });

      const rows = await double.asPrismaService().client.parkingSpot.findMany({
        orderBy: { label: 'asc' },
      });

      expect(rows.map((row) => row.label)).toEqual(['A1', 'B1']);
    });

    it('imposes no ordering when none was asked for', async () => {
      // Prisma promises nothing about the order of an unordered findMany, and
      // `bulk-reservation.service.ts` issues one. The double used to sort
      // anyway, which would let a test rely on an order production may not
      // give it — this pins the absence of that sort, not a preference for
      // insertion order.
      // The groups are deliberately the reverse of the labels: insertion order
      // is B1, A1 and group-then-label order is A1, B1, so re-adding the sort
      // this test exists to forbid turns it red. With both spots in
      // ascending-group order the two lists coincide and the guard is unpinned.
      double.seedSpot({ label: 'B1', group: 'SHARED' });
      double.seedSpot({ label: 'A1', group: 'IT' });

      const rows = await double.asPrismaService().client.parkingSpot.findMany({});

      expect(rows.map((row) => row.label)).toEqual(['B1', 'A1']);
    });

    it('refuses a filter key it does not model instead of ignoring it', async () => {
      double.seedSpot({ label: 'A1' });

      await expect(
        double.asPrismaService().client.parkingSpot.findMany({
          where: { active: true, retiredAt: null },
        } as never)
      ).rejects.toThrow('PrismaDouble does not model this parking spot filter');
    });

    it('refuses an ordering it does not model', async () => {
      await expect(
        double
          .asPrismaService()
          .client.parkingSpot.findMany({ orderBy: { createdAt: 'desc' } } as never)
      ).rejects.toThrow('PrismaDouble does not model this parking spot ordering');
    });
  });

  describe('reservation.findMany (day overview: an exact-date lookup with `user` joined)', () => {
    it('joins a real user for a user-held reservation', async () => {
      const spot = double.seedSpot({ label: 'A1' });
      const holder = double.seedUser({ name: 'Alice' });
      double.seedReservation({ parkingSpotId: spot.id, userId: holder.id, date: '2026-03-02' });

      const [row] = await double.asPrismaService().client.reservation.findMany({
        where: { date: new Date('2026-03-02T00:00:00.000Z') },
        include: { user: true },
      });

      expect(row?.user).toMatchObject({ id: holder.id, name: 'Alice' });
    });

    it('joins `null`, not `{}`, for a guest reservation — mirroring a real `User?` relation', async () => {
      // `copy(null)` is `{ ...null }`, which is `{}`, not `null`. A `{}` here
      // would be typed `UserRow | null` but non-null at runtime, so
      // `toPublicReservation` (`common/prisma-mapping.ts`) would take the
      // `holder !== null` branch and render a nameless `USER` holder instead
      // of the `GUEST` holder this row actually has.
      const spot = double.seedSpot({ label: 'A1' });
      double.seedReservation({
        parkingSpotId: spot.id,
        userId: null,
        guestName: 'Jan Host',
        date: '2026-03-02',
      });

      const [row] = await double.asPrismaService().client.reservation.findMany({
        where: { date: new Date('2026-03-02T00:00:00.000Z') },
        include: { user: true },
      });

      expect(row?.user).toBeNull();
    });
  });

  describe('reservationWindowSettings.findUnique', () => {
    it('answers the singleton', async () => {
      double.seedWindowSettings({ openDaysBefore: 14 });

      const row = await double
        .asPrismaService()
        .client.reservationWindowSettings.findUnique({ where: { id: 1 } });

      expect(row?.openDaysBefore).toBe(14);
    });

    it('refuses a lookup for any other row rather than handing back the singleton', async () => {
      double.seedWindowSettings();

      await expect(
        double.asPrismaService().client.reservationWindowSettings.findUnique({ where: { id: 2 } })
      ).rejects.toThrow(
        'PrismaDouble does not model a window settings row other than the singleton'
      );
    });
  });

  describe('reset', () => {
    it('empties every collection and counter the double owns', async () => {
      const spot = double.seedSpot({ label: 'A1' });
      const user = double.seedUser({});
      double.seedReservation({ parkingSpotId: spot.id, userId: user.id, date: '2026-03-02' });
      double.seedWaitlistEntry({ parkingSpotId: spot.id, userId: user.id, date: '2026-03-03' });
      double.seedWindowSettings();
      double.icsTokenCollisions = 1;
      await double.asPrismaService().client.auditLog.createMany({
        data: [
          {
            actorUserId: user.id,
            action: 'SPOT_UPDATED',
            entityType: 'ParkingSpot',
            entityId: spot.id,
            payload: {},
          },
        ],
      });

      double.reset();

      expect(double.spots).toHaveLength(0);
      expect(double.users).toHaveLength(0);
      expect(double.reservations).toHaveLength(0);
      expect(double.waitlist).toHaveLength(0);
      expect(double.auditLogs).toHaveLength(0);
      expect(double.auditLogCreateManyCalls).toBe(0);
      expect(double.windowSettings).toBeNull();
      expect(double.icsTokenCollisions).toBe(0);
    });
  });
});
