import { render, act } from '@testing-library/react';
import { nextLockExpiryAt, pruneExpiredLocks, useCellLocks } from './use-cell-locks';
import type { CellLockView } from '../lot-view';

/**
 * `@garage/realtime-client` is doubled at the wrapper boundary so this
 * suite can hand the hook an event when it chooses and take the connection
 * away when it chooses. Task 21's own 69 tests already prove a real socket
 * parses a payload and calls the handler; what is under test here is what this
 * screen *does* with one.
 */

const handlers = new Map<string, (payload: unknown) => void>();
let connectionStatus = 'connected';

jest.mock('@garage/realtime-client', () => ({
  useRealtime: () => ({ status: mockStatus() }),
  useRealtimeEvent: (event: string, handler: (payload: unknown) => void) => {
    mockHandlers().set(event, handler);
  },
}));

function mockStatus() {
  return connectionStatus;
}
function mockHandlers() {
  return handlers;
}

const DATE = '2026-09-28';
const OTHER_DATE = '2026-09-29';

function lockView(overrides: Partial<CellLockView> = {}): CellLockView {
  return {
    holderId: 'user-1',
    holderName: 'Jana Dvořáková',
    expiresAt: '2026-09-28T09:00:30.000Z',
    ...overrides,
  };
}

describe('pruneExpiredLocks', () => {
  const at = (iso: string) => Date.parse(iso);

  it('keeps a hold that has not lapsed, by reference', () => {
    const locks = new Map([['spot-a', lockView()]]);
    expect(pruneExpiredLocks(locks, at('2026-09-28T09:00:00.000Z'))).toBe(locks);
  });

  it('drops a hold whose TTL has run out', () => {
    const locks = new Map([['spot-a', lockView()]]);
    const next = pruneExpiredLocks(locks, at('2026-09-28T09:00:31.000Z'));
    expect(next.size).toBe(0);
  });

  it('drops a hold exactly at its expiry', () => {
    const locks = new Map([['spot-a', lockView()]]);
    expect(pruneExpiredLocks(locks, at('2026-09-28T09:00:30.000Z')).size).toBe(0);
  });

  it('drops only what has lapsed', () => {
    const locks = new Map([
      ['spot-a', lockView({ expiresAt: '2026-09-28T09:00:10.000Z' })],
      ['spot-b', lockView({ expiresAt: '2026-09-28T09:01:00.000Z' })],
    ]);
    const next = pruneExpiredLocks(locks, at('2026-09-28T09:00:30.000Z'));
    expect([...next.keys()]).toEqual(['spot-b']);
  });

  it('keeps rather than drops a hold with an unparseable expiry', () => {
    // `Date.parse('later') <= now` is false because every comparison with NaN
    // is. Keeping is the right direction: the tile is drawn as busy, and the
    // holder's own heartbeat will correct it.
    const locks = new Map([['spot-a', lockView({ expiresAt: 'later' })]]);
    expect(pruneExpiredLocks(locks, at('2030-01-01T00:00:00.000Z'))).toBe(locks);
  });

  it('is a no-op on an empty map, by reference', () => {
    const locks: ReadonlyMap<string, CellLockView> = new Map();
    expect(pruneExpiredLocks(locks, Date.now())).toBe(locks);
  });
});

describe('nextLockExpiryAt', () => {
  it('is null when nothing is held', () => {
    expect(nextLockExpiryAt(new Map())).toBeNull();
  });

  it('is the soonest expiry, not the first inserted', () => {
    const locks = new Map([
      ['spot-a', lockView({ expiresAt: '2026-09-28T09:01:00.000Z' })],
      ['spot-b', lockView({ expiresAt: '2026-09-28T09:00:10.000Z' })],
    ]);
    expect(nextLockExpiryAt(locks)).toBe(Date.parse('2026-09-28T09:00:10.000Z'));
  });

  it('skips an unparseable expiry rather than returning NaN', () => {
    // `setTimeout(NaN)` fires immediately, forever — the busy loop the floor
    // in `renewDelayMs` exists to prevent, in a different place.
    const locks = new Map([
      ['spot-a', lockView({ expiresAt: 'nonsense' })],
      ['spot-b', lockView({ expiresAt: '2026-09-28T09:00:10.000Z' })],
    ]);
    expect(nextLockExpiryAt(locks)).toBe(Date.parse('2026-09-28T09:00:10.000Z'));
    expect(nextLockExpiryAt(new Map([['spot-a', lockView({ expiresAt: 'nonsense' })]]))).toBeNull();
  });
});

describe('useCellLocks', () => {
  let seen: ReadonlyMap<string, CellLockView> = new Map();

  function Harness({ date }: { date: string | null }) {
    seen = useCellLocks(date);
    return null;
  }

  function emit(event: string, payload: unknown) {
    const handler = handlers.get(event);
    if (handler === undefined) throw new Error(`no handler for ${event}`);
    act(() => {
      handler(payload);
    });
  }

  const locked = (spotId: string, expiresAt = '2026-09-28T09:00:30.000Z', date = DATE) => ({
    date,
    parkingSpotId: spotId,
    lockedBy: { id: 'user-1', name: 'Jana Dvořáková', licensePlate: null },
    expiresAt,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(Date.parse('2026-09-28T09:00:00.000Z'));
    handlers.clear();
    connectionStatus = 'connected';
    seen = new Map();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts empty', () => {
    render(<Harness date={DATE} />);
    expect(seen.size).toBe(0);
  });

  it('records a hold announced for the day on screen', () => {
    render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a'));

    expect(seen.get('spot-a')).toEqual({
      holderId: 'user-1',
      holderName: 'Jana Dvořáková',
      expiresAt: '2026-09-28T09:00:30.000Z',
    });
  });

  it('ignores a hold announced for another day', () => {
    // A client is typically in several day rooms; nothing in the delivery says
    // which one a message came through, so the payload's own date is the only
    // thing that can be trusted.
    render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a', '2026-09-28T09:00:30.000Z', OTHER_DATE));
    expect(seen.size).toBe(0);
  });

  it('releases a hold on cell:unlocked', () => {
    render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a'));
    emit('cell:unlocked', { date: DATE, parkingSpotId: 'spot-a' });
    expect(seen.size).toBe(0);
  });

  it('ignores an unlock for another day', () => {
    render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a'));
    emit('cell:unlocked', { date: OTHER_DATE, parkingSpotId: 'spot-a' });
    expect(seen.has('spot-a')).toBe(true);
  });

  it('drops a hold on its own when the TTL runs out and no unlock arrives', () => {
    // The case the contract names: a browser closed mid-edit, a dropped
    // socket. Without this the tile hatches forever.
    render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a'));
    expect(seen.size).toBe(1);

    act(() => {
      jest.advanceTimersByTime(30_001);
    });

    expect(seen.size).toBe(0);
  });

  it('does not drop a hold before its TTL', () => {
    render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a'));

    act(() => {
      jest.advanceTimersByTime(29_000);
    });

    expect(seen.size).toBe(1);
  });

  it('expires each hold at its own time, not all at the first', () => {
    render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a', '2026-09-28T09:00:10.000Z'));
    emit('cell:locked', locked('spot-b', '2026-09-28T09:00:40.000Z'));

    act(() => {
      jest.advanceTimersByTime(11_000);
    });
    expect([...seen.keys()]).toEqual(['spot-b']);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(seen.size).toBe(0);
  });

  it('reschedules the sweep when it fires before the clock reaches the expiry', () => {
    // What `jest.advanceTimersByTime` alone cannot exercise: a real clock can
    // fire a `setTimeout` a moment early (a coarse timer, a clock nudged
    // backwards). `Date.now` is stubbed for exactly the instant the scheduled
    // sweep runs, so `pruneExpiredLocks` sees "not yet" and legitimately
    // returns the same map — the fix under test is whether a sweep is still
    // pending afterwards, not whether this one tick drops the hold.
    render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a', '2026-09-28T09:00:10.000Z'));
    expect(seen.size).toBe(1);

    const early = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T09:00:09.999Z'));
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    early.mockRestore();

    // The early tick changed nothing — same map, same size.
    expect(seen.size).toBe(1);

    // The real clock has now reached the expiry. Without a reschedule from
    // inside the fired callback, nothing is pending here and the hold would
    // survive forever.
    act(() => {
      jest.advanceTimersByTime(2);
    });
    expect(seen.size).toBe(0);
  });

  it('extends a hold when the holder renews it', () => {
    render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a', '2026-09-28T09:00:10.000Z'));
    emit('cell:locked', locked('spot-a', '2026-09-28T09:00:40.000Z'));

    act(() => {
      jest.advanceTimersByTime(11_000);
    });
    expect(seen.has('spot-a')).toBe(true);
  });

  it('forgets everything when the day changes', () => {
    const view = render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a'));
    expect(seen.size).toBe(1);

    view.rerender(<Harness date={OTHER_DATE} />);
    expect(seen.size).toBe(0);
  });

  it('forgets everything when the connection drops', () => {
    // While the socket is down no `cell:unlocked` can arrive, so continuing to
    // hatch a tile would assert something this client cannot know is still
    // true. Being briefly blind is the safe direction — the lock is a
    // courtesy and the API re-checks everything anyway.
    const view = render(<Harness date={DATE} />);
    emit('cell:locked', locked('spot-a'));
    expect(seen.size).toBe(1);

    connectionStatus = 'disconnected';
    view.rerender(<Harness date={DATE} />);

    expect(seen.size).toBe(0);
  });
});
