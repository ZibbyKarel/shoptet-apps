/**
 * The outbound gate on a `cell:lock` acknowledgement, exercised against a
 * holder that actually carries secrets.
 *
 * ## Why this file exists at all
 *
 * `realtime.gateway.spec.ts` asserts that no acknowledgement carries an
 * `icsToken`, and it passes — but it passes because `realtime-handshake.ts`'s
 * `loadUserSummary` builds its three fields explicitly, *not* because
 * {@link RealtimeGateway.acknowledge} validates. Mutation testing proved it:
 * deleting the ack's `safeParse` entirely failed **zero** tests. A defence that
 * only the code path it guards can reach is a defence nothing can falsify, and
 * this project's signature defect is claims that were reasoned rather than
 * exercised.
 *
 * So this spec removes the narrowing that hides it. `LockService` is replaced
 * with one whose grant returns the **whole user row** as its holder — exactly
 * what a Prisma stand-in whose `select` is not honoured produced when this leak
 * was first found — and then asserts that the acknowledgement and the broadcast
 * still leave the server with three fields.
 *
 * The double stands in for a dependency's *behaviour*. The protocol is real:
 * a real Socket.io handshake, a real ack over the wire, a real room broadcast.
 *
 * The secret at stake is `icsToken`, which is the whole of the authentication
 * on a personal calendar feed (`doc/decision/0053-*`) — and the ack crosses to
 * *another user's* browser, which is what makes it worse than a self-leak.
 */

import { randomUUID } from 'node:crypto';
import type { UserSummary } from '@garage/contract';
import type { CellLockAck } from '@garage/contract/realtime';
import type { LockCell, LockGrant, LockRequester } from './lock.service';
import { LockService } from './lock.service';
import { RealtimeTestClient } from './testing/realtime-test-client';
import type { RealtimeTestApp } from './testing/realtime-test-app';
import { seedEmployee, startRealtimeTestApp } from './testing/realtime-test-app';

const DAY = '2026-10-01';

/** Everything a `user` row holds, which is what must not leave. */
const SECRETS = ['icsToken', 'email', 'oktaId', 'role', 'active', 'preferredParkingSpotId'];

/**
 * The real grant sequence — first asker wins, second is told who holds it —
 * with a holder nobody narrowed.
 *
 * `as unknown as UserSummary` is the point of the class: TypeScript refuses
 * this shape, and the shipped `realtime-handshake.ts` `loadUserSummary` cannot
 * produce it — but a Prisma `select` that is silently dropped can, and did.
 *
 * Nothing expires here: expiry has its own tests against the real service in
 * `lock.service.spec.ts` and `realtime.gateway.spec.ts`, and a lapse in the
 * middle of this one would only make it flaky.
 */
class LeakyLockService extends LockService {
  readonly ttlMs = 30_000;

  private readonly held = new Map<string, UserSummary>();

  acquire(cell: LockCell, requester: LockRequester): LockGrant {
    const key = `${cell.date}|${cell.parkingSpotId}`;
    const holder = this.held.get(key);
    const expiresAt = new Date(Date.now() + this.ttlMs);

    if (holder !== undefined && holder.id !== requester.user.id) {
      return { outcome: 'HELD_BY_OTHER', holder, expiresAt };
    }

    const fat = {
      id: requester.user.id,
      name: requester.user.name,
      licensePlate: requester.user.licensePlate,
      icsToken: 'ics-secret-value',
      email: 'leaked@example.com',
      oktaId: 'okta-leaked',
      role: 'USER',
      active: true,
      preferredParkingSpotId: null,
    } as unknown as UserSummary;
    this.held.set(key, fat);
    return { outcome: 'ACQUIRED', holder: fat, expiresAt };
  }

  release(): boolean {
    return true;
  }

  releaseSocket(): LockCell[] {
    return [];
  }

  onExpired(): void {
    // Nothing lapses in this spec.
  }
}

describe('a cell:lock holder the gateway did not narrow', () => {
  let harness: RealtimeTestApp;
  let alice: { id: string; name: string; licensePlate: string | null; oktaId: string };
  let bob: { id: string; name: string; licensePlate: string | null; oktaId: string };
  const open: RealtimeTestClient[] = [];
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    harness = await startRealtimeTestApp({
      overrides: (builder) => builder.overrideProvider(LockService).useClass(LeakyLockService),
    });
    alice = seedEmployee(harness.double, {
      oktaId: 'okta-alice',
      name: 'Alice',
      licensePlate: '1AB 2345',
    });
    bob = seedEmployee(harness.double, { oktaId: 'okta-bob', name: 'Bob' });
  });

  afterAll(async () => {
    await Promise.all(open.map((client) => client.disconnect()));
    await harness?.close();
    process.env = originalEnv;
  });

  async function connectAs(employee: { oktaId: string }): Promise<RealtimeTestClient> {
    const client = await RealtimeTestClient.connect({
      baseUrl: harness.baseUrl,
      token: harness.tokenFor({ subject: employee.oktaId }),
    });
    open.push(client);
    return client;
  }

  it('is stripped to the contract’s three fields before the acknowledgement crosses to the loser', async () => {
    // The `HELD_BY_OTHER` ack is the leak path: it is the one acknowledgement
    // that describes *somebody else*, and it goes to the user who lost the race.
    const holder = await connectAs(alice);
    const rival = await connectAs(bob);
    const cell = { date: DAY, parkingSpotId: randomUUID() };
    await holder.emitWithAck('cell:lock', cell);

    const ack = (await rival.emitWithAck('cell:lock', cell)) as CellLockAck;

    expect(ack.result).toBe('HELD_BY_OTHER');
    const lockedBy = (ack as { lockedBy: Record<string, unknown> }).lockedBy;
    expect(Object.keys(lockedBy).sort()).toEqual(['id', 'licensePlate', 'name']);
    expect(lockedBy['name']).toBe('Alice');
    const wire = JSON.stringify(ack);
    for (const secret of SECRETS) {
      expect(wire).not.toContain(secret);
    }
    expect(wire).not.toContain('ics-secret-value');
  });

  it('is stripped to the contract’s three fields before the broadcast leaves for other tiles', async () => {
    const holder = await connectAs(alice);
    const watcher = await connectAs(bob);
    watcher.emit('day:subscribe', { date: DAY });
    // `day:subscribe` has no acknowledgement, so the room join is settled by a
    // round trip the server *does* answer rather than by a sleep.
    await watcher.emitWithAck('cell:lock', { date: DAY, parkingSpotId: randomUUID() });

    const cell = { date: DAY, parkingSpotId: randomUUID() };
    await holder.emitWithAck('cell:lock', cell);

    const locked = await watcher.waitForEvent(
      'cell:locked',
      (payload: { parkingSpotId: string }) => payload.parkingSpotId === cell.parkingSpotId
    );

    const lockedBy = (locked as { lockedBy: Record<string, unknown> }).lockedBy;
    expect(Object.keys(lockedBy).sort()).toEqual(['id', 'licensePlate', 'name']);
    expect(lockedBy['name']).toBe('Alice');
    const wire = JSON.stringify(locked);
    for (const secret of SECRETS) {
      expect(wire).not.toContain(secret);
    }
    expect(wire).not.toContain('ics-secret-value');
  });
});
