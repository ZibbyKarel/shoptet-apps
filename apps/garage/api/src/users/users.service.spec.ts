import { AuditLogService } from '../audit/audit-log.service';
import { PrismaDouble } from '../testing/prisma-double';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let double: PrismaDouble;
  let users: UsersService;

  beforeEach(() => {
    double = new PrismaDouble();
    users = new UsersService(
      double.asPrismaService(),
      new AuditLogService(double.asPrismaService())
    );
  });

  describe('adminList', () => {
    beforeEach(() => {
      double.seedUser({ name: 'Alice', email: 'alice@example.test', role: 'ADMIN' });
      double.seedUser({ name: 'Bob', email: 'bob@example.test' });
      double.seedUser({ name: 'Carol', email: 'carol@example.test', active: false });
    });

    it('never exposes another person’s ICS token', async () => {
      // The token is the only credential on a personal calendar feed URL. An
      // admin has no reason to hold one, and `adminUserSchema` omits it.
      const listed = await users.adminList({});

      for (const user of listed) {
        expect(user).not.toHaveProperty('icsToken');
      }
    });

    it('filters by role and by activity', async () => {
      await expect(users.adminList({ role: 'ADMIN' })).resolves.toHaveLength(1);
      await expect(users.adminList({ active: false })).resolves.toHaveLength(1);
    });

    it('matches the search term against name or email, case-insensitively', async () => {
      await expect(users.adminList({ search: 'ALI' })).resolves.toMatchObject([{ name: 'Alice' }]);
      await expect(users.adminList({ search: 'bob@' })).resolves.toMatchObject([{ name: 'Bob' }]);
      await expect(users.adminList({ search: 'nobody' })).resolves.toEqual([]);
    });

    describe('excludingReservedOrQueuedFor', () => {
      it('excludes a user who already has a reservation that day, for any spot', async () => {
        const spotA = double.seedSpot({ label: 'A1' });
        const spotB = double.seedSpot({ label: 'B1' });
        const bob = double.users.find((row) => row.name === 'Bob');
        if (bob === undefined) throw new Error('seed missing Bob');
        double.seedReservation({ parkingSpotId: spotB.id, userId: bob.id, date: '2026-09-15' });

        const listed = await users.adminList({
          active: true,
          excludingReservedOrQueuedFor: { parkingSpotId: spotA.id, date: '2026-09-15' },
        });

        expect(listed.map((row) => row.name)).not.toContain('Bob');
      });

      it('excludes a user already queued for this specific spot that day', async () => {
        const spotA = double.seedSpot({ label: 'A1' });
        const bob = double.users.find((row) => row.name === 'Bob');
        if (bob === undefined) throw new Error('seed missing Bob');
        double.seedWaitlistEntry({ parkingSpotId: spotA.id, userId: bob.id, date: '2026-09-15' });

        const listed = await users.adminList({
          active: true,
          excludingReservedOrQueuedFor: { parkingSpotId: spotA.id, date: '2026-09-15' },
        });

        expect(listed.map((row) => row.name)).not.toContain('Bob');
      });

      it('does not exclude a user queued for a different spot that day', async () => {
        const spotA = double.seedSpot({ label: 'A1' });
        const spotB = double.seedSpot({ label: 'B1' });
        const bob = double.users.find((row) => row.name === 'Bob');
        if (bob === undefined) throw new Error('seed missing Bob');
        double.seedWaitlistEntry({ parkingSpotId: spotB.id, userId: bob.id, date: '2026-09-15' });

        const listed = await users.adminList({
          active: true,
          excludingReservedOrQueuedFor: { parkingSpotId: spotA.id, date: '2026-09-15' },
        });

        expect(listed.map((row) => row.name)).toContain('Bob');
      });

      it('does not exclude anyone for a reservation or queue entry on a different day', async () => {
        const spotA = double.seedSpot({ label: 'A1' });
        const bob = double.users.find((row) => row.name === 'Bob');
        if (bob === undefined) throw new Error('seed missing Bob');
        double.seedReservation({ parkingSpotId: spotA.id, userId: bob.id, date: '2026-09-16' });

        const listed = await users.adminList({
          active: true,
          excludingReservedOrQueuedFor: { parkingSpotId: spotA.id, date: '2026-09-15' },
        });

        expect(listed.map((row) => row.name)).toContain('Bob');
      });

      it('applies role/active/search filtering and the exclusion together', async () => {
        const spotA = double.seedSpot({ label: 'A1' });
        const alice = double.users.find((row) => row.name === 'Alice');
        if (alice === undefined) throw new Error('seed missing Alice');
        // Alice is the seeded ADMIN; excluding her should still leave the
        // `role: 'ADMIN'` filter's result empty, not error.
        double.seedReservation({ parkingSpotId: spotA.id, userId: alice.id, date: '2026-09-15' });

        const listed = await users.adminList({
          role: 'ADMIN',
          excludingReservedOrQueuedFor: { parkingSpotId: spotA.id, date: '2026-09-15' },
        });

        expect(listed).toEqual([]);
      });

      it('leaves the list untouched when no filter is given', async () => {
        const listed = await users.adminList({ active: true });
        expect(listed.map((row) => row.name).sort()).toEqual(['Alice', 'Bob']);
      });
    });
  });

  describe('adminUpdate', () => {
    it('changes the role and records the before and the after', async () => {
      const admin = double.seedUser({ name: 'Admin', role: 'ADMIN' });
      const target = double.seedUser({ name: 'Target' });

      const result = await users.adminUpdate({ id: target.id, role: 'ADMIN' }, admin);

      expect(result.role).toBe('ADMIN');
      expect(double.auditLogs).toEqual([
        expect.objectContaining({
          actorUserId: admin.id,
          action: 'USER_UPDATED',
          entityType: 'User',
          entityId: target.id,
          payload: {
            change: 'admin-updated',
            before: { role: 'USER', active: true },
            after: { role: 'ADMIN', active: true },
          },
        }),
      ]);
    });

    it('offboards by deactivating, never by deleting the row', async () => {
      const admin = double.seedUser({ role: 'ADMIN' });
      const target = double.seedUser();

      await users.adminUpdate({ id: target.id, active: false }, admin);

      expect(double.users).toHaveLength(2);
      expect(double.users.find((row) => row.id === target.id)?.active).toBe(false);
    });

    it('rejects an unknown user with NOT_FOUND', async () => {
      const admin = double.seedUser({ role: 'ADMIN' });

      await expect(
        users.adminUpdate({ id: '11111111-1111-4111-8111-111111111111', active: false }, admin)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    describe('the two ways an admin could lock everybody out', () => {
      it('refuses to demote the last active admin', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        double.seedUser({ role: 'ADMIN', active: false });

        await expect(
          users.adminUpdate({ id: admin.id, role: 'USER' }, admin)
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(double.users[0]?.role).toBe('ADMIN');
      });

      it('refuses to deactivate the last active admin', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        const other = double.seedUser({ role: 'ADMIN' });

        // `other` acts, so this is not caught by the self-deactivation rule.
        await users.adminUpdate({ id: admin.id, active: false }, other);
        await expect(
          users.adminUpdate({ id: other.id, active: false }, { id: 'someone-else' })
        ).rejects.toMatchObject({ code: 'CONFLICT' });
      });

      it('refuses an admin deactivating themselves, even with others left', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        double.seedUser({ role: 'ADMIN' });

        await expect(
          users.adminUpdate({ id: admin.id, active: false }, admin)
        ).rejects.toMatchObject({ code: 'CONFLICT' });
      });

      it('allows demoting yourself while another active admin remains', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        double.seedUser({ role: 'ADMIN' });

        await expect(
          users.adminUpdate({ id: admin.id, role: 'USER' }, admin)
        ).resolves.toMatchObject({ role: 'USER' });
      });

      it('writes no audit entry for a refused change', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });

        await expect(
          users.adminUpdate({ id: admin.id, role: 'USER' }, admin)
        ).rejects.toBeDefined();

        expect(double.auditLogs).toHaveLength(0);
      });
    });
  });
});
