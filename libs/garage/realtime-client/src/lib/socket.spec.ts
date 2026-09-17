/**
 * The handshake: what the socket presents to the gateway, where it puts it,
 * and what happens to it across a reconnect.
 *
 * Everything here is asserted on packets a **real** `socket.io-client` socket
 * produced — see `src/__fixtures__/offline-socket.ts` for why nothing in this
 * suite is allowed to invent the client's protocol.
 */

import { SOCKET_IO_PATH } from '@garage/contract/realtime';
import { createOfflineSocket } from '../__fixtures__/offline-socket';
import type { OfflineSocket } from '../__fixtures__/offline-socket';
import { DEFAULT_SOCKET_PATH, createRealtimeSocket, toHandshakeAuth } from './socket';

const URL = 'http://parking.test';

/** Drains the microtask queue the async token provider hops through. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('toHandshakeAuth', () => {
  it('carries the token when there is one', () => {
    expect(toHandshakeAuth('jwt-value')).toEqual({ token: 'jwt-value' });
  });

  it.each([null, undefined, ''])('omits the key entirely for %p', (token) => {
    const auth = toHandshakeAuth(token);
    // `{ token: undefined }` would serialise as a present-but-null credential.
    expect('token' in auth).toBe(false);
  });
});

describe('DEFAULT_SOCKET_PATH', () => {
  it('is the contract’s shared SOCKET_IO_PATH, not a private literal', () => {
    // The other half of the cross-halves guarantee is
    // `apps/garage/api/src/realtime/realtime-io.adapter.spec.ts`, which asserts the
    // server's configured path against the same import. Each side fails its
    // own suite the moment it stops importing `SOCKET_IO_PATH` and hardcodes a
    // literal instead — which is the only way the two halves could disagree
    // without either failing on its own (`doc/decision/0113-*`).
    expect(DEFAULT_SOCKET_PATH).toBe(SOCKET_IO_PATH);
  });
});

describe('createRealtimeSocket', () => {
  it('dials the configured path without putting anything in the query string', () => {
    const socket = createRealtimeSocket({
      url: URL,
      getAccessToken: () => 'jwt-value',
      autoConnect: false,
      forceNew: true,
    });
    const manager = socket.io as unknown as {
      uri: string;
      opts: Record<string, unknown>;
    };

    expect(manager.opts['path']).toBe(DEFAULT_SOCKET_PATH);
    // The two ways a token could leak into an access log.
    expect(manager.opts['query']).toBeUndefined();
    expect(manager.opts['extraHeaders']).toBeUndefined();
    expect(manager.uri).not.toContain('jwt-value');
    expect(manager.uri).not.toContain('?');

    socket.disconnect();
  });
});

describe('the handshake token', () => {
  let offline: OfflineSocket;

  afterEach(() => {
    offline?.dispose();
  });

  it('travels in the handshake auth payload, not the URL', async () => {
    offline = createOfflineSocket({ url: URL, getAccessToken: () => 'jwt-first' });

    offline.open();
    await settle();

    expect(offline.handshakes()).toEqual([{ token: 'jwt-first' }]);
  });

  it('is re-read from the provider on every reconnect', async () => {
    // A provider whose answer changes — which is what a rotating access token
    // looks like from here (`libs/garage/auth`'s refresh runs independently).
    let token = 'jwt-first';
    offline = createOfflineSocket({ url: URL, getAccessToken: () => token });

    offline.open();
    await settle();
    offline.acceptConnection();

    token = 'jwt-second';
    offline.drop();
    // The manager's reconnect loop fires the same `open` event again; the
    // socket's real `onopen` is what turns it into a new CONNECT packet.
    offline.open();
    await settle();

    expect(offline.handshakes()).toEqual([{ token: 'jwt-first' }, { token: 'jwt-second' }]);
  });

  it('awaits an asynchronous provider before connecting', async () => {
    offline = createOfflineSocket({
      url: URL,
      getAccessToken: async () => 'jwt-async',
    });

    offline.open();
    expect(offline.handshakes()).toEqual([]); // nothing sent while the token is pending
    await settle();

    expect(offline.handshakes()).toEqual([{ token: 'jwt-async' }]);
  });

  it('sends an empty handshake when there is no session, rather than a null token', async () => {
    offline = createOfflineSocket({ url: URL, getAccessToken: () => null });

    offline.open();
    await settle();

    expect(offline.handshakes()).toEqual([{}]);
  });

  it('sends an empty handshake when the provider fails, rather than connecting anyway', async () => {
    offline = createOfflineSocket({
      url: URL,
      getAccessToken: () => Promise.reject(new Error('refresh failed for jwt-secret')),
    });

    offline.open();
    await settle();

    expect(offline.handshakes()).toEqual([{}]);
  });
});
