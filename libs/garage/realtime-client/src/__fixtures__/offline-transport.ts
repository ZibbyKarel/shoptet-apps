/**
 * A real `socket.io-client` socket with the network taken away.
 *
 * ## Why not a mock socket
 *
 * A hand-written `{ on, off, emit, disconnect }` double would let this suite
 * assert whatever it decided the client's API is. That is the failure mode
 * this project has already shipped: a test double that fabricates a
 * dependency's shape produces a suite that is green and wrong. So nothing here
 * stands in for Socket.io's behaviour or its protocol. The object under test
 * is the socket `createRealtimeSocket` really returns, running its real
 * `onopen` / `onpacket` / `onclose` / `emit` implementations.
 *
 * Exactly two seams are replaced, and both are *transport*, not protocol:
 *
 * - `manager.open()` — a no-op, so no engine and no HTTP request is created;
 * - `manager._packet()` — captures the encoded packets the socket would have
 *   put on the wire.
 *
 * Everything else is driven the way the real manager drives it: the manager's
 * own `open` / `close` / `packet` events, which is literally what
 * `Socket.subEvents()` subscribes to. A reconnect here is the same event the
 * reconnect timer fires in production.
 *
 * ## Why the packet type codes are discovered, not written down
 *
 * Feeding an inbound packet means naming socket.io-parser's numeric packet
 * types. Hard-coding `2` for EVENT would be exactly the invented-protocol
 * problem again — a number this file believes, that nothing checks. Instead
 * {@link discoverPacketTypes} makes the installed client *emit* one of each
 * and reads the codes off its own output, so the fixture cannot disagree with
 * the library it is driving. CONNECT_ERROR is the one the client never sends,
 * so {@link discoverConnectErrorType} identifies it by the effect only it has
 * — see that function.
 *
 * This file imports `../lib/socket` for **types only**, so it stays loadable
 * from inside a `jest.mock('../lib/socket', …)` factory — which is how the
 * hook specs let `useRealtimeConnection` build its own real socket and still
 * get hold of it. See `connection.spec.tsx`.
 */

import { io } from 'socket.io-client';
import type { RealtimeSocket } from '../lib/socket';

/** A decoded Socket.io packet, as `Manager._packet` receives it. */
export interface ProtocolPacket {
  type: number;
  nsp: string;
  id?: number;
  data?: unknown;
}

/** The manager members this fixture reaches for. All exist at runtime. */
interface ManagerInternals {
  open(): unknown;
  _packet(packet: ProtocolPacket): void;
  emit(event: string, ...args: unknown[]): void;
}

function managerOf(socket: RealtimeSocket): ManagerInternals {
  return socket.io as unknown as ManagerInternals;
}

interface PacketTypes {
  readonly connect: number;
  readonly event: number;
  readonly ack: number;
  readonly connectError: number;
}

let packetTypes: PacketTypes | undefined;

/**
 * Reads the numeric packet type codes off the installed client.
 *
 * - CONNECT — the packet a socket sends when its engine opens;
 * - EVENT — the packet `emit` produces;
 * - ACK — the packet the socket sends back when it acknowledges an inbound
 *   event that carried an id.
 *
 * Each one is produced by the real client, so this cannot drift from
 * socket.io-parser the way a copied constant could.
 */
function discoverPacketTypes(): PacketTypes {
  if (packetTypes !== undefined) return packetTypes;

  const sent: ProtocolPacket[] = [];
  const probe = io('http://packet-type.probe/', {
    autoConnect: false,
    forceNew: true,
    // Object form, so the CONNECT packet is produced synchronously.
    auth: {},
  }) as RealtimeSocket;
  const manager = managerOf(probe);
  manager.open = () => probe;
  manager._packet = (packet) => sent.push(packet);

  probe.connect();
  manager.emit('open');
  const connect = expectPacket(sent, 0, 'CONNECT').type;

  // The socket has to be connected before `emit` writes rather than buffers,
  // and before an inbound event is dispatched rather than queued.
  manager.emit('packet', { type: connect, nsp: '/', data: { sid: 'probe-sid' } });

  (probe as unknown as { emit(ev: string, payload: unknown): void }).emit('probe', {});
  const event = expectPacket(sent, 1, 'EVENT').type;

  (probe as unknown as { on(ev: string, listener: unknown): void }).on(
    'probe',
    (_payload: unknown, ack: () => void) => ack()
  );
  manager.emit('packet', { type: event, nsp: '/', id: 7, data: ['probe', {}] });
  const ack = expectPacket(sent, 2, 'ACK').type;

  probe.disconnect();
  const connectError = discoverConnectErrorType({ connect, event, ack });
  packetTypes = { connect, event, ack, connectError };
  return packetTypes;
}

/**
 * Finds the CONNECT_ERROR code the same way, except that the client never
 * *sends* one — it only ever receives it — so there is no outgoing packet to
 * read it off.
 *
 * So it is identified by its **effect** instead, which is the pair of
 * observations that make CONNECT_ERROR unique among socket.io-parser's seven
 * packet types (`socket.js` `onpacket`):
 *
 * - it makes the socket emit `connect_error`, and
 * - it makes the socket **inactive** (`socket.active === false`), because the
 *   CONNECT_ERROR branch calls `destroy()`, which drops the socket's manager
 *   subscriptions so no reconnect is attempted.
 *
 * DISCONNECT also destroys but emits `disconnect`, not `connect_error`; a
 * CONNECT with no `sid` emits `connect_error` but leaves the socket active.
 * Only CONNECT_ERROR does both, so the conjunction identifies it exactly —
 * and it is identified by running the installed client, not by writing `4`
 * down.
 */
function discoverConnectErrorType(known: Omit<PacketTypes, 'connectError'>): number {
  const taken = [known.connect, known.event, known.ack];

  for (let candidate = 0; candidate <= 6; candidate += 1) {
    if (taken.includes(candidate)) continue;

    const probe = io('http://packet-type.probe/', {
      autoConnect: false,
      forceNew: true,
      auth: {},
    }) as RealtimeSocket;
    const manager = managerOf(probe);
    manager.open = () => probe;
    manager._packet = () => undefined;

    let sawConnectError = false;
    (probe as unknown as { on(ev: string, listener: () => void): void }).on('connect_error', () => {
      sawConnectError = true;
    });

    probe.connect();
    manager.emit('open');
    // The realistic sequence: the socket sent CONNECT, and the server answers
    // with this candidate packet instead of accepting.
    manager.emit('packet', { type: candidate, nsp: '/', data: { message: 'probe' } });

    const destroyed = !probe.active;
    probe.disconnect();

    if (sawConnectError && destroyed) return candidate;
  }

  throw new Error(
    'No socket.io-parser packet type both emitted "connect_error" and deactivated the ' +
      'socket. The fixture can no longer identify CONNECT_ERROR from the installed ' +
      'client — fix the fixture, not the test.'
  );
}

function expectPacket(
  sent: readonly ProtocolPacket[],
  index: number,
  what: string
): ProtocolPacket {
  const packet = sent[index];
  if (packet === undefined) {
    throw new Error(
      `socket.io-client produced no ${what} packet (saw ${sent.length}). The fixture's ` +
        `assumptions about the client no longer hold — fix the fixture, not the test.`
    );
  }
  return packet;
}

export interface OfflineSocket {
  /** The socket under test — a real one, from `createRealtimeSocket`. */
  readonly socket: RealtimeSocket;
  /** Every packet the socket tried to put on the wire, in order. */
  readonly sent: readonly ProtocolPacket[];
  /**
   * The `auth` payload of each CONNECT packet — one per (re)connection, which
   * is what makes "a reconnect re-sends the token" observable.
   */
  handshakes(): readonly Record<string, unknown>[];
  /** `[eventName, payload]` for each event the socket emitted. */
  emitted(): readonly [string, unknown][];
  /** The engine opened: drives the real `Socket.onopen`, which sends CONNECT. */
  open(): void;
  /** The server accepted the handshake: the socket becomes `connected`. */
  acceptConnection(sid?: string): void;
  /** The transport dropped: drives the real `Socket.onclose`. */
  drop(reason?: string): void;
  /**
   * The server **refused** the handshake — the gateway's namespace middleware
   * said no, which for this project means the access token was rejected.
   *
   * Drives the real `Socket.onpacket` CONNECT_ERROR branch, which calls
   * `destroy()` before emitting `connect_error`. After this the socket is
   * inactive and socket.io will never reconnect it: that is the behaviour
   * `useRealtimeConnection` has to recover from, not a fixture invention.
   */
  rejectHandshake(message?: string): void;
  /**
   * The transport itself failed — the gateway was unreachable, not
   * unwelcoming.
   *
   * Drives the manager's `error` event, which is what `Socket.subEvents()`
   * binds to `onerror`; that emits `connect_error` too, but **without**
   * destroying the socket, so it stays `active` and socket.io's own reconnect
   * timer owns the retry. The pair with {@link rejectHandshake} is what makes
   * the `socket.active` branch in `useRealtimeConnection` observable.
   */
  failTransport(message?: string): void;
  /** The server broadcast an event into a room this socket is in. */
  deliver(event: string, payload: unknown): void;
  /** The server answered the most recent emit of `event` with `payload`. */
  acknowledge(event: string, payload: unknown): void;
  /** Close the socket and release the manager. */
  dispose(): void;
}

/**
 * Replaces a real socket's transport with this fixture's, and returns the
 * handle used to drive it.
 *
 * `connect()` is called for you, so the socket's real `subEvents()` has run
 * and the manager's events reach it — but nothing is open until
 * {@link OfflineSocket.open} is called. The socket must therefore have been
 * built with `autoConnect: false`; one built with `autoConnect: true` has
 * already asked for a real engine by the time this function sees it.
 */
export function attachOfflineTransport(socket: RealtimeSocket): OfflineSocket {
  const types = discoverPacketTypes();
  const sent: ProtocolPacket[] = [];

  const manager = managerOf(socket);
  manager.open = () => socket;
  manager._packet = (packet) => sent.push(packet);

  socket.connect();

  const nsp = () => (socket as unknown as { nsp: string }).nsp;
  const eventPackets = () => sent.filter((packet) => packet.type === types.event);

  return {
    socket,
    sent,
    handshakes: () =>
      sent
        .filter((packet) => packet.type === types.connect)
        .map((packet) => (packet.data ?? {}) as Record<string, unknown>),
    emitted: () =>
      eventPackets().map((packet) => {
        const [name, payload] = packet.data as [string, unknown];
        return [name, payload];
      }),
    open: () => manager.emit('open'),
    acceptConnection: (sid = 'offline-sid') =>
      manager.emit('packet', { type: types.connect, nsp: nsp(), data: { sid } }),
    drop: (reason = 'transport close') => manager.emit('close', reason),
    rejectHandshake: (message = 'Unauthorized') =>
      // `packet.data.message` is what `Socket.onpacket` reads to build the
      // `Error` it hands `connect_error`; `packet.data.data` is the optional
      // extra payload. Neither is read by this lib — the token's rejection is
      // never logged — but the shape is the server's, so it is sent as the
      // server sends it.
      manager.emit('packet', {
        type: types.connectError,
        nsp: nsp(),
        data: { message },
      }),
    failTransport: (message = 'xhr poll error') => manager.emit('error', new Error(message)),
    deliver: (event, payload) =>
      manager.emit('packet', { type: types.event, nsp: nsp(), data: [event, payload] }),
    acknowledge: (event, payload) => {
      const packet = [...eventPackets()]
        .reverse()
        .find((candidate) => (candidate.data as [string])[0] === event);
      if (packet === undefined || packet.id === undefined) {
        throw new Error(`No acknowledged "${event}" packet was sent.`);
      }
      manager.emit('packet', { type: types.ack, nsp: nsp(), id: packet.id, data: [payload] });
    },
    dispose: () => {
      socket.disconnect();
    },
  };
}

/**
 * Sockets built while a spec has `../lib/socket` mocked, newest last.
 *
 * `useRealtimeConnection` creates its own socket and hands it to nobody, so a
 * spec that wants to drive that socket has to be handed it from inside the
 * factory that created it. This registry is that hand-off; the spec clears it
 * between tests with {@link resetOfflineSockets}.
 */
const registry: OfflineSocket[] = [];

export function recordOfflineSocket(offline: OfflineSocket): OfflineSocket {
  registry.push(offline);
  return offline;
}

/** The socket the component under test is currently using. */
export function currentOfflineSocket(): OfflineSocket {
  const offline = registry[registry.length - 1];
  if (offline === undefined) {
    throw new Error('No socket has been created yet — did the connection effect run?');
  }
  return offline;
}

export function offlineSocketCount(): number {
  return registry.length;
}

export function resetOfflineSockets(): void {
  registry.length = 0;
}
