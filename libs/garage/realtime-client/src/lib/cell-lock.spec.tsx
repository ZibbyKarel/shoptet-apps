/**
 * The editing hold: taking it, renewing it, and giving it back.
 *
 * Same harness as `connection.spec.tsx` — the socket is a real
 * `socket.io-client` socket with only its transport replaced, so a `cell:lock`
 * here is a genuine EVENT packet with a genuine ack id, answered through the
 * client's own acknowledgement registry.
 */

import { act, render } from '@testing-library/react';
import { currentOfflineSocket, resetOfflineSockets } from '../__fixtures__/offline-transport';
import type { OfflineSocket } from '../__fixtures__/offline-transport';
import {
  API_URL,
  DATE,
  OTHER_SPOT_ID,
  SPOT_ID,
  USER_SUMMARY,
  settle,
} from '../__fixtures__/realtime-fixtures';
import { RealtimeProvider } from './connection';
import { CELL_LOCK_ACK_ATTEMPTS, CELL_LOCK_ACK_TIMEOUT_MS, useCellLock } from './cell-lock';
import type { CellLockState } from './cell-lock';

jest.mock('./socket', () => {
  const actual = jest.requireActual('./socket');
  const transport = jest.requireActual('../__fixtures__/offline-transport');
  return {
    ...actual,
    createRealtimeSocket: (options: Record<string, unknown>) =>
      transport.recordOfflineSocket(
        transport.attachOfflineTransport(
          actual.createRealtimeSocket({ ...options, autoConnect: false, forceNew: true })
        )
      ).socket,
  };
});

/** `Date.now()` inside the tests, so `expiresAt` and the clock agree. */
const NOW = Date.parse('2026-09-15T08:00:00.000Z');
const TTL_MS = 30_000;
const EXPIRES_AT = new Date(NOW + TTL_MS).toISOString();

const cell = { date: DATE, parkingSpotId: SPOT_ID };

let states: CellLockState[] = [];

function Editor({
  parkingSpotId = SPOT_ID,
  enabled = true,
}: {
  parkingSpotId?: string;
  enabled?: boolean;
}) {
  states.push(useCellLock({ date: DATE, parkingSpotId, enabled }));
  return null;
}

interface TreeProps {
  parkingSpotId?: string;
  enabled?: boolean;
  /** `false` unmounts the editor while the connection stays up. */
  editorMounted?: boolean;
  onInvalidPayload?: (report: { event: string; issues: readonly string[] }) => void;
}

/**
 * The provider plus one editor.
 *
 * The editor is mounted and unmounted **inside** a provider that stays up,
 * which is the real shape of the scenario: a reservation form opens and closes
 * on a page whose socket lives as long as the tab. It also isolates the
 * behaviour under test — React runs a deletion's cleanups parent-first, so
 * unmounting the *whole* tree tears the socket down before `useCellLock` gets
 * to say anything, and the release then happens server-side instead (see the
 * note in `cell-lock.ts`). That case is covered by `connection.spec.tsx`,
 * which asserts the socket is closed on unmount.
 */
function Tree({
  editorMounted = true,
  // Required on `RealtimeProvider`; a no-op for the specs that are not about
  // reporting, the real `jest.fn()` for the one that is.
  onInvalidPayload = () => undefined,
  ...editor
}: TreeProps) {
  return (
    <RealtimeProvider
      url={API_URL}
      getAccessToken={() => 'jwt-value'}
      onInvalidPayload={onInvalidPayload}
    >
      {editorMounted ? <Editor {...editor} /> : null}
    </RealtimeProvider>
  );
}

function renderEditor(props: TreeProps = {}) {
  const view = render(<Tree {...props} />);
  return {
    ...view,
    update: async (next: TreeProps) => {
      await act(async () => {
        view.rerender(<Tree {...next} />);
      });
    },
  };
}

async function connect(): Promise<OfflineSocket> {
  await act(async () => {
    currentOfflineSocket().open();
    await settle();
  });
  await act(async () => {
    currentOfflineSocket().acceptConnection();
  });
  return currentOfflineSocket();
}

/** Answer the outstanding `cell:lock` the way the gateway would. */
async function grant(offline: OfflineSocket, expiresAt = EXPIRES_AT): Promise<void> {
  await act(async () => {
    offline.acknowledge('cell:lock', { result: 'ACQUIRED', expiresAt });
  });
}

/** Refuse the outstanding `cell:lock`: somebody else is holding the cell. */
async function refuse(offline: OfflineSocket, expiresAt = EXPIRES_AT): Promise<void> {
  await act(async () => {
    offline.acknowledge('cell:lock', {
      result: 'HELD_BY_OTHER',
      lockedBy: USER_SUMMARY,
      expiresAt,
    });
  });
}

/** The gateway broadcasting a hold's end into the day room. */
async function announceFree(offline: OfflineSocket, ref = cell): Promise<void> {
  await act(async () => {
    offline.deliver('cell:unlocked', ref);
  });
}

beforeEach(() => {
  states = [];
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
  resetOfflineSockets();
});

describe('CellLockState', () => {
  // Compile-time assertions: the `@ts-expect-error` is the check, and it fails
  // the build the moment the line it guards starts compiling again.
  //
  // The two are not equally strong, and it is worth knowing which is which.
  // The first is unrepresentable: `held-by-other` *requires* `expiresAt` and
  // `lockedBy`, so no value of any shape reaches that member with `null` in
  // them. The second is only discouraged — it is the excess-property check
  // that rejects `expiresAt` on `idle`, and that check fires on a fresh object
  // literal alone, so a value widened through a variable can still carry a
  // stale `expiresAt` into an `idle` state. Both stay: the weaker one still
  // stops the mistake being *written* here, which is where it would be
  // written.

  it('cannot describe a contended cell without the expiry that un-sticks it', () => {
    // Both mechanisms that end a `held-by-other` need this expiry — the
    // backstop timer takes a non-nullable `string` — so a `null` here is the
    // frozen "právě upravuje …" of `doc/decision/0111-*`, signed off by the
    // compiler.
    // @ts-expect-error `expiresAt` and `lockedBy` are required on this member
    const stuck: CellLockState = { status: 'held-by-other', expiresAt: null, lockedBy: null };

    expect(stuck.status).toBe('held-by-other');
  });

  it('cannot attach an expiry to a state that has not asked for anything', () => {
    // @ts-expect-error `idle` carries no expiry to be stale
    const wrong: CellLockState = { status: 'idle', expiresAt: EXPIRES_AT };

    expect(wrong.status).toBe('idle');
  });
});

describe('useCellLock', () => {
  it('asks for the hold once the connection is up', async () => {
    renderEditor();
    expect(states.at(-1)).toEqual({ status: 'idle' });

    const offline = await connect();

    expect(offline.emitted()).toEqual([['cell:lock', cell]]);
    expect(states.at(-1)).toEqual({ status: 'requesting' });

    await grant(offline);
    expect(states.at(-1)).toEqual({ status: 'held', expiresAt: EXPIRES_AT });
  });

  it('extends the hold with a heartbeat before it expires', async () => {
    renderEditor();
    const offline = await connect();
    await grant(offline);

    expect(offline.emitted()).toHaveLength(1);

    // Halfway through the TTL — there is no separate heartbeat command, so the
    // renewal is a second `cell:lock` for the same cell (see the contract's
    // `cellLockCommandSchema`).
    await act(async () => {
      jest.advanceTimersByTime(TTL_MS / 2);
    });

    expect(offline.emitted()).toEqual([
      ['cell:lock', cell],
      ['cell:lock', cell],
    ]);
    // Renewing does not drop the component out of `held` and back to
    // `requesting` — the hold was never lost.
    expect(states.at(-1)).toEqual({ status: 'held', expiresAt: EXPIRES_AT });

    // And it keeps going: the second ack schedules a third request.
    const nextExpiry = new Date(NOW + TTL_MS / 2 + TTL_MS).toISOString();
    await grant(offline, nextExpiry);
    await act(async () => {
      jest.advanceTimersByTime(TTL_MS / 2);
    });

    expect(offline.emitted()).toHaveLength(3);
  });

  it('does not send a heartbeat before the renewal is due', async () => {
    renderEditor();
    const offline = await connect();
    await grant(offline);

    await act(async () => {
      jest.advanceTimersByTime(TTL_MS / 2 - 1);
    });

    expect(offline.emitted()).toHaveLength(1);
  });

  it('releases the hold when the component unmounts', async () => {
    const view = renderEditor();
    const offline = await connect();
    await grant(offline);

    await view.update({ editorMounted: false });

    expect(offline.emitted()).toEqual([
      ['cell:lock', cell],
      ['cell:unlock', cell],
    ]);
  });

  it('stops the heartbeat when the component unmounts', async () => {
    const view = renderEditor();
    const offline = await connect();
    await grant(offline);

    await view.update({ editorMounted: false });
    await act(async () => {
      jest.advanceTimersByTime(TTL_MS * 4);
    });

    // Two packets and no more: the lock, and the release. A timer that
    // outlived the component would keep re-taking a hold nobody can give back.
    expect(offline.emitted()).toHaveLength(2);
  });

  it('releases the hold when the form is disabled, without unmounting', async () => {
    const view = renderEditor();
    const offline = await connect();
    await grant(offline);

    await view.update({ enabled: false });

    expect(offline.emitted()).toEqual([
      ['cell:lock', cell],
      ['cell:unlock', cell],
    ]);
    expect(states.at(-1)).toEqual({ status: 'idle' });
  });

  it('releases the old cell and takes the new one when the cell changes', async () => {
    const view = renderEditor();
    const offline = await connect();
    await grant(offline);

    await view.update({ parkingSpotId: OTHER_SPOT_ID });

    expect(offline.emitted()).toEqual([
      ['cell:lock', cell],
      ['cell:unlock', cell],
      ['cell:lock', { date: DATE, parkingSpotId: OTHER_SPOT_ID }],
    ]);
  });

  it('does not try to release a hold it never got', async () => {
    const view = renderEditor();
    const offline = await connect();
    await refuse(offline);

    expect(states.at(-1)).toEqual({
      status: 'held-by-other',
      expiresAt: EXPIRES_AT,
      lockedBy: USER_SUMMARY,
    });

    await view.update({ editorMounted: false });

    expect(offline.emitted()).toEqual([['cell:lock', cell]]);
  });

  it('does not poll a cell somebody else is holding while their hold is still valid', async () => {
    renderEditor();
    const offline = await connect();
    await refuse(offline);

    // Right up to the last millisecond of the other client's TTL. Nothing is
    // sent: polling a contended cell from every open tab is exactly the traffic
    // the `cell:unlocked` broadcast exists to avoid.
    await act(async () => {
      jest.advanceTimersByTime(TTL_MS - 1);
    });

    expect(offline.emitted()).toHaveLength(1);
    expect(states.at(-1)).toEqual({
      status: 'held-by-other',
      expiresAt: EXPIRES_AT,
      lockedBy: USER_SUMMARY,
    });
  });

  it('asks again when the cell it wants is announced free', async () => {
    renderEditor();
    const offline = await connect();
    await refuse(offline);

    // The ordinary ending: the other client closed their form, and the gateway
    // broadcast it. Without this the form sits on "právě upravuje Jana
    // Dvořáková" until it is closed — the frozen tile the hook exists to
    // prevent, one layer up.
    await announceFree(offline);

    expect(offline.emitted()).toEqual([
      ['cell:lock', cell],
      ['cell:lock', cell],
    ]);
    // And it stops naming a holder it can no longer vouch for while it asks.
    expect(states.at(-1)).toEqual({ status: 'requesting' });

    const nextExpiry = new Date(Date.now() + TTL_MS).toISOString();
    await grant(offline, nextExpiry);
    expect(states.at(-1)).toEqual({ status: 'held', expiresAt: nextExpiry });
  });

  it('asks again when the other hold lapses and no broadcast arrives', async () => {
    renderEditor();
    const offline = await connect();
    await refuse(offline);

    // The backstop `doc/decision/0111-*` asks for by name. The gateway does
    // broadcast an expiry, but a client that only believed the broadcast would
    // be frozen by any path that loses it, and 0111 says in as many words that
    // neither side should assume the other did it.
    await act(async () => {
      jest.advanceTimersByTime(TTL_MS);
    });

    expect(offline.emitted()).toEqual([
      ['cell:lock', cell],
      ['cell:lock', cell],
    ]);
    expect(states.at(-1)).toEqual({ status: 'requesting' });
  });

  it('does not re-ask on a broadcast about a different cell', async () => {
    renderEditor();
    const offline = await connect();
    await refuse(offline);

    await announceFree(offline, { date: DATE, parkingSpotId: OTHER_SPOT_ID });

    expect(offline.emitted()).toHaveLength(1);
    expect(states.at(-1)).toEqual({
      status: 'held-by-other',
      expiresAt: EXPIRES_AT,
      lockedBy: USER_SUMMARY,
    });
  });

  it('does not re-ask on a broadcast about a hold it has itself', async () => {
    renderEditor();
    const offline = await connect();
    await grant(offline);

    // The gateway may echo a room broadcast back to its own sender, and a
    // supersession elsewhere can produce one for a cell this client holds.
    // Tearing the hold down and re-taking it on that would turn somebody else's
    // event into this form's problem.
    await announceFree(offline);

    expect(offline.emitted()).toHaveLength(1);
    expect(states.at(-1)).toEqual({ status: 'held', expiresAt: EXPIRES_AT });
  });

  it('does not keep re-asking once the cell it recovered is its own', async () => {
    renderEditor();
    const offline = await connect();
    await refuse(offline);
    await announceFree(offline);

    // The contended-retry timer scheduled by the refusal was due at `NOW +
    // TTL_MS`. The clock has to pass that instant for this test to say anything
    // about whether it was cancelled — stopping short of it would prove only
    // that it had not fired *yet*, which is true of a leaked timer too.
    await grant(offline, new Date(Date.now() + TTL_MS).toISOString());
    await act(async () => {
      jest.advanceTimersByTime(TTL_MS / 2);
    });
    expect(offline.emitted()).toHaveLength(3);

    await grant(offline, new Date(Date.now() + TTL_MS).toISOString());
    await act(async () => {
      jest.advanceTimersByTime(TTL_MS / 2);
    });

    // Now at exactly `NOW + TTL_MS`. Four packets: the refusal, the re-ask the
    // broadcast caused, and two renewals. A contended-retry timer left running
    // beside the renewal would have fired at this instant and made it five.
    expect(Date.now()).toBe(NOW + TTL_MS);
    expect(offline.emitted()).toHaveLength(4);
    expect(states.at(-1)?.status).toBe('held');
  });

  it('re-takes the hold after a reconnect, because the server dropped it', async () => {
    renderEditor();
    const offline = await connect();
    await grant(offline);

    await act(async () => {
      offline.drop();
    });
    expect(states.at(-1)).toEqual({ status: 'idle' });

    await act(async () => {
      offline.open();
      await settle();
    });
    await act(async () => {
      offline.acceptConnection();
    });

    // No `cell:unlock` in between: the socket was already gone, so the server
    // released the hold itself and saying so would be a packet buffered onto
    // the *next* connection, where it means something else.
    expect(offline.emitted()).toEqual([
      ['cell:lock', cell],
      ['cell:lock', cell],
    ]);
  });

  it('re-sends a renewal whose acknowledgement never comes back', async () => {
    renderEditor();
    const offline = await connect();
    await grant(offline);

    // The renewal falls due and is sent…
    await act(async () => {
      jest.advanceTimersByTime(TTL_MS / 2);
    });
    expect(offline.emitted()).toHaveLength(2);

    // …and its ack is dropped in flight. `socket.emit` has no timeout of its
    // own, so without `.timeout()` the callback would simply never be called
    // and the heartbeat would end here, silently, with the form still `held`.
    await act(async () => {
      jest.advanceTimersByTime(CELL_LOCK_ACK_TIMEOUT_MS);
    });

    expect(offline.emitted()).toEqual([
      ['cell:lock', cell],
      ['cell:lock', cell],
      ['cell:lock', cell],
    ]);
    // Still inside the TTL the half-TTL renewal left room for.
    expect(Date.now()).toBeLessThan(Date.parse(EXPIRES_AT));
    expect(states.at(-1)).toEqual({ status: 'held', expiresAt: EXPIRES_AT });
  });

  it('keeps the heartbeat going once a retried renewal is answered', async () => {
    renderEditor();
    const offline = await connect();
    await grant(offline);

    await act(async () => {
      jest.advanceTimersByTime(TTL_MS / 2 + CELL_LOCK_ACK_TIMEOUT_MS);
    });
    expect(offline.emitted()).toHaveLength(3);

    // The retry is answered. The budget resets, so the next lost ack gets its
    // own retry rather than inheriting a spent one.
    const nextExpiry = new Date(Date.now() + TTL_MS).toISOString();
    await grant(offline, nextExpiry);
    expect(states.at(-1)).toEqual({ status: 'held', expiresAt: nextExpiry });

    await act(async () => {
      jest.advanceTimersByTime(TTL_MS / 2);
    });
    expect(offline.emitted()).toHaveLength(4);
    await act(async () => {
      jest.advanceTimersByTime(CELL_LOCK_ACK_TIMEOUT_MS);
    });
    expect(offline.emitted()).toHaveLength(5);
  });

  it('drops to idle rather than claiming a hold the server stopped confirming', async () => {
    renderEditor();
    const offline = await connect();
    await grant(offline);

    // The renewal and its one retry both go unanswered.
    await act(async () => {
      jest.advanceTimersByTime(TTL_MS / 2 + CELL_LOCK_ACK_TIMEOUT_MS * CELL_LOCK_ACK_ATTEMPTS);
    });

    expect(offline.emitted()).toHaveLength(1 + CELL_LOCK_ACK_ATTEMPTS);
    // Not a frozen `held` with an `expiresAt` in the past: the server released
    // this cell, and a form that still says otherwise is the stale "právě
    // upravuje …" the lock exists to prevent.
    expect(states.at(-1)).toEqual({ status: 'idle' });

    // And nothing keeps asking.
    await act(async () => {
      jest.advanceTimersByTime(TTL_MS * 4);
    });
    expect(offline.emitted()).toHaveLength(1 + CELL_LOCK_ACK_ATTEMPTS);
  });

  it('does not leave a form stuck at "requesting" when the first ack is lost', async () => {
    renderEditor();
    const offline = await connect();
    expect(states.at(-1)).toEqual({ status: 'requesting' });

    await act(async () => {
      jest.advanceTimersByTime(CELL_LOCK_ACK_TIMEOUT_MS * CELL_LOCK_ACK_ATTEMPTS);
    });

    expect(offline.emitted()).toHaveLength(CELL_LOCK_ACK_ATTEMPTS);
    expect(states.at(-1)).toEqual({ status: 'idle' });
  });

  it('drops an acknowledgement that fails its schema instead of scheduling on it', async () => {
    const onInvalidPayload = jest.fn();
    renderEditor({ onInvalidPayload });
    const offline = await connect();

    await act(async () => {
      // `expiresAt` is `z.iso.datetime()`. Unparsed, this reaches
      // `Date.parse` as `NaN` and schedules a timer that fires immediately.
      offline.acknowledge('cell:lock', { result: 'ACQUIRED', expiresAt: 'soon' });
    });

    expect(onInvalidPayload).toHaveBeenCalledWith({
      event: 'cell:lock',
      issues: expect.arrayContaining([expect.stringContaining('expiresAt')]),
    });
    expect(states.at(-1)).toEqual({ status: 'idle' });

    await act(async () => {
      jest.advanceTimersByTime(TTL_MS * 4);
    });
    expect(offline.emitted()).toHaveLength(1);
  });
});
