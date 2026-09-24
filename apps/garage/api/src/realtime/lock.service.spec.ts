/**
 * The editing hold's lifetime, ownership and expiry.
 *
 * Fake timers throughout, because every claim here is about *when*: a hold that
 * lapses at the right moment, a renewal that pushes that moment out, and an
 * expiry that tells somebody. Real timers would make the suite either slow or
 * flaky, and there is no library protocol being exercised here — the timer is
 * Node's and the map is this file's — so a clock is the honest double.
 *
 * The gateway's use of this class, and everything about Socket.io, is exercised
 * against real sockets in `realtime.gateway.spec.ts`.
 */

import { ConfigService } from '@nestjs/config';
import type { UserSummary } from '@garage/contract';
import type { ApiEnv } from '../env';
import type { LockCell } from './lock.service';
import { LockService } from './lock.service';

const TTL_MS = 30_000;

const CELL: LockCell = {
  date: '2026-09-15',
  parkingSpotId: '018f3a2b-0000-7000-8000-000000000001',
};
const OTHER_CELL: LockCell = {
  date: '2026-09-16',
  parkingSpotId: '018f3a2b-0000-7000-8000-000000000001',
};

const ALICE: UserSummary = {
  id: '018f3a2b-0000-7000-8000-00000000000a',
  name: 'Alice',
  licensePlate: '1AB 2345',
};
const BOB: UserSummary = {
  id: '018f3a2b-0000-7000-8000-00000000000b',
  name: 'Bob',
  licensePlate: null,
};

function buildService(ttlMs = TTL_MS): LockService {
  // The real `ConfigService.get` shape, because that is how the service reads
  // its TTL — a hand-written `{ ttlMs }` would test a constructor this class
  // does not have.
  const configService = {
    get: (key: string) => {
      expect(key).toBe('REALTIME_LOCK_TTL_MS');
      return ttlMs;
    },
  } as unknown as ConfigService<ApiEnv, true>;
  return new LockService(configService);
}

describe('LockService', () => {
  let service: LockService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
    service = buildService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('taking a hold', () => {
    it('grants a free cell, with a deadline one TTL out', () => {
      const grant = service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      expect(grant.outcome).toBe('ACQUIRED');
      expect(grant.holder).toEqual(ALICE);
      expect(grant.expiresAt.getTime()).toBe(Date.now() + TTL_MS);
    });

    it('reads its TTL from the environment rather than a constant', () => {
      // The property that makes "no test backdoor" possible: the specs run the
      // same code against a short TTL, differing only in this value.
      const short = buildService(250);

      const grant = short.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      expect(short.ttlMs).toBe(250);
      expect(grant.expiresAt.getTime()).toBe(Date.now() + 250);
      short.onModuleDestroy();
    });
  });

  describe('a contended cell', () => {
    it('refuses the second user and names the first', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      const grant = service.acquire(CELL, { user: BOB, socketId: 'socket-b' });

      expect(grant.outcome).toBe('HELD_BY_OTHER');
      expect(grant.holder).toEqual(ALICE);
    });

    it('tells the loser when the hold lapses, so it can clear its own state', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      jest.advanceTimersByTime(TTL_MS / 2);

      const grant = service.acquire(CELL, { user: BOB, socketId: 'socket-b' });

      // The *holder's* deadline, not a fresh TTL from the moment of the refusal.
      // `useCellLock` renders `held-by-other` with this `expiresAt`, so a wrong
      // one here is a tile that clears at the wrong time.
      expect(grant.expiresAt.getTime()).toBe(Date.now() + TTL_MS / 2);
    });

    it('does not disturb the holder’s deadline', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      const expired: LockCell[] = [];
      service.onExpired((cell) => expired.push(cell));

      jest.advanceTimersByTime(TTL_MS / 2);
      service.acquire(CELL, { user: BOB, socketId: 'socket-b' });
      jest.advanceTimersByTime(TTL_MS / 2);

      // A refused request that reset the timer would let a rival keep a cell
      // alive forever by asking for it.
      expect(expired).toEqual([CELL]);
    });

    it('hands the cell over once the previous hold has lapsed', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      jest.advanceTimersByTime(TTL_MS);

      const grant = service.acquire(CELL, { user: BOB, socketId: 'socket-b' });

      expect(grant.outcome).toBe('ACQUIRED');
      expect(grant.holder).toEqual(BOB);
    });
  });

  describe('renewing', () => {
    it('extends the same hold rather than refusing its own holder', () => {
      const first = service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      jest.advanceTimersByTime(TTL_MS / 2);

      const renewed = service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      expect(renewed.outcome).toBe('ACQUIRED');
      expect(renewed.expiresAt.getTime()).toBe(first.expiresAt.getTime() + TTL_MS / 2);
    });

    it('pushes the expiry out, so a renewed hold does not lapse on the old deadline', () => {
      const expired: LockCell[] = [];
      service.onExpired((cell) => expired.push(cell));
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      // Renew at half the TTL — exactly what `CELL_LOCK_RENEW_FRACTION` makes
      // the client do — then run past the *original* deadline.
      jest.advanceTimersByTime(TTL_MS / 2);
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      jest.advanceTimersByTime(TTL_MS / 2 + 1);

      expect(expired).toEqual([]);

      // …and it still lapses eventually. A renewal that cancelled the timer
      // without scheduling a new one would also pass the assertion above.
      jest.advanceTimersByTime(TTL_MS);
      expect(expired).toEqual([CELL]);
    });

    it('survives a reconnect: the same user on a new socket keeps the hold', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      const renewed = service.acquire(CELL, { user: ALICE, socketId: 'socket-a2' });

      expect(renewed.outcome).toBe('ACQUIRED');
    });
  });

  describe('giving a hold back', () => {
    it('releases the holder’s own cell', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      expect(service.release(CELL, { user: ALICE, socketId: 'socket-a' })).toBe(true);
      expect(service.acquire(CELL, { user: BOB, socketId: 'socket-b' }).outcome).toBe('ACQUIRED');
    });

    it('refuses to let one user drop another’s hold', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      expect(service.release(CELL, { user: BOB, socketId: 'socket-b' })).toBe(false);
      expect(service.acquire(CELL, { user: BOB, socketId: 'socket-b' }).outcome).toBe(
        'HELD_BY_OTHER'
      );
    });

    it('refuses a superseded connection of the holder’s own user', () => {
      // Two live connections of one user on one cell — a second tab, or a page
      // that reloaded before the server noticed the old socket. The second
      // `acquire` is a renewal, and it re-keys the hold onto `socket-b`.
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      service.acquire(CELL, { user: ALICE, socketId: 'socket-b' });

      // `socket-a` closing its dialog must not drop the hold `socket-b` holds.
      // Keyed by user alone this is `true`, and the bay reads `Volné` to
      // everybody while the other tab's form is still open.
      expect(service.release(CELL, { user: ALICE, socketId: 'socket-a' })).toBe(false);
      // …and the hold really is still there, rather than merely unreported:
      // a second user asking for the cell is still refused.
      expect(service.acquire(CELL, { user: BOB, socketId: 'socket-x' }).outcome).toBe(
        'HELD_BY_OTHER'
      );
    });

    it('lets the connection that re-took the hold give it back', () => {
      // The other half of the pair above: keying release by socket must not
      // strand a hold that survived a reconnect. `useCellLock` re-requests on
      // the new connection, which re-keys the hold, so the connection that
      // closes the form is always the one that owns it.
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      service.acquire(CELL, { user: ALICE, socketId: 'socket-b' });

      expect(service.release(CELL, { user: ALICE, socketId: 'socket-b' })).toBe(true);
      expect(service.acquire(CELL, { user: BOB, socketId: 'socket-x' }).outcome).toBe('ACQUIRED');
    });

    it('is a no-op for a cell nobody holds', () => {
      expect(service.release(CELL, { user: ALICE, socketId: 'socket-a' })).toBe(false);
    });

    it('stops the expiry, so a released cell is not announced twice', () => {
      const expired: LockCell[] = [];
      service.onExpired((cell) => expired.push(cell));
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      service.release(CELL, { user: ALICE, socketId: 'socket-a' });
      jest.advanceTimersByTime(TTL_MS * 2);

      // The gateway broadcasts `cell:unlocked` on the release itself; a later
      // expiry event would be a second `cell:unlocked` for a cell somebody else
      // may have taken in between.
      expect(expired).toEqual([]);
    });
  });

  describe('a dropped connection', () => {
    it('frees every hold that socket had, and names them', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      service.acquire(OTHER_CELL, { user: ALICE, socketId: 'socket-a' });

      expect(service.releaseSocket('socket-a')).toEqual([CELL, OTHER_CELL]);
      expect(service.acquire(CELL, { user: BOB, socketId: 'socket-b' }).outcome).toBe('ACQUIRED');
    });

    it('leaves other sockets’ holds alone', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      service.acquire(OTHER_CELL, { user: BOB, socketId: 'socket-b' });

      expect(service.releaseSocket('socket-a')).toEqual([CELL]);
      expect(service.acquire(OTHER_CELL, { user: ALICE, socketId: 'socket-a' }).outcome).toBe(
        'HELD_BY_OTHER'
      );
    });

    it('does not drop the hold its user re-took on a new socket', () => {
      // The reconnect race the client's design makes real: `useCellLock`
      // re-requests the hold on the new connection, and on an abrupt network
      // drop the server can take until `pingTimeout` (~20s) to notice the old
      // socket is gone. If ownership were keyed by socket id, the *late*
      // disconnect of the dead socket would free a hold the user is actively
      // renewing, and their own form would go quiet.
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a2' });

      expect(service.releaseSocket('socket-a')).toEqual([]);
      expect(service.acquire(CELL, { user: BOB, socketId: 'socket-b' }).outcome).toBe(
        'HELD_BY_OTHER'
      );
    });

    it('stops the expiry of the holds it freed', () => {
      const expired: LockCell[] = [];
      service.onExpired((cell) => expired.push(cell));
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      service.releaseSocket('socket-a');
      jest.advanceTimersByTime(TTL_MS * 2);

      expect(expired).toEqual([]);
    });
  });

  describe('expiry', () => {
    it('announces a hold that lapses, with its holder', () => {
      const expired: { cell: LockCell; holder: UserSummary }[] = [];
      service.onExpired((cell, holder) => expired.push({ cell, holder }));
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      jest.advanceTimersByTime(TTL_MS);

      expect(expired).toEqual([{ cell: CELL, holder: ALICE }]);
    });

    it('does not announce it early', () => {
      const expired: LockCell[] = [];
      service.onExpired((cell) => expired.push(cell));
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      jest.advanceTimersByTime(TTL_MS - 1);

      expect(expired).toEqual([]);
    });

    it('announces it once, not once per tick', () => {
      const expired: LockCell[] = [];
      service.onExpired((cell) => expired.push(cell));
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      jest.advanceTimersByTime(TTL_MS * 10);

      expect(expired).toEqual([CELL]);
    });

    it('does not announce a lapse for a cell that was handed straight on', () => {
      // A `cell:unlocked` fired after the new holder's `cell:locked` would
      // clear, on every client, a hold that is live.
      const expired: LockCell[] = [];
      service.onExpired((cell) => expired.push(cell));
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      // Move past the deadline without letting the timer run, which is what a
      // busy event loop does, then let the rival take the cell.
      jest.setSystemTime(new Date(Date.now() + TTL_MS + 1));
      const grant = service.acquire(CELL, { user: BOB, socketId: 'socket-b' });
      jest.advanceTimersByTime(TTL_MS * 2);

      expect(grant.outcome).toBe('ACQUIRED');
      // Bob's own hold lapses at the end; Alice's supersession does not produce
      // a second, earlier announcement.
      expect(expired).toEqual([CELL]);
    });

    it('tells every registered listener', () => {
      const first: LockCell[] = [];
      const second: LockCell[] = [];
      service.onExpired((cell) => first.push(cell));
      service.onExpired((cell) => second.push(cell));
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      jest.advanceTimersByTime(TTL_MS);

      expect(first).toEqual([CELL]);
      expect(second).toEqual([CELL]);
    });
  });

  describe('shutdown', () => {
    it('drops every pending expiry, so nothing fires into a closing server', () => {
      const expired: LockCell[] = [];
      service.onExpired((cell) => expired.push(cell));
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });
      service.acquire(OTHER_CELL, { user: BOB, socketId: 'socket-b' });

      service.onModuleDestroy();
      jest.advanceTimersByTime(TTL_MS * 2);

      expect(expired).toEqual([]);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('cells are distinguished by both halves of the pair', () => {
    it('same spot, different day', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      expect(service.acquire(OTHER_CELL, { user: BOB, socketId: 'socket-b' }).outcome).toBe(
        'ACQUIRED'
      );
    });

    it('same day, different spot', () => {
      service.acquire(CELL, { user: ALICE, socketId: 'socket-a' });

      const elsewhere = { date: CELL.date, parkingSpotId: OTHER_CELL.parkingSpotId + 'x' };
      expect(service.acquire(elsewhere, { user: BOB, socketId: 'socket-b' }).outcome).toBe(
        'ACQUIRED'
      );
    });
  });
});
