/**
 * A Socket.io client for the gateway's tests, built out of the protocol's own
 * reference implementation.
 *
 * ## Why not `socket.io-client`
 *
 * `socket.io-client` is a **wrapped library**: `eslint.config.mjs` gives it to
 * `libs/garage/realtime-client` and bans it from `apps/**` and `libs/**` alike, spec
 * files included. That ban is right and this file does not weaken it — the
 * `libs/garage/realtime-client` wrapper is a React lib (`scope:web`), so `apps/garage/api`
 * (`scope:api`) could not import it either.
 *
 * ## What this is instead, and why it is *stronger* evidence
 *
 * Both layers of the wire are driven by the packages that define them:
 *
 * - `engine.io-parser` — the transport layer. `decodePacket` names the frame
 *   type (`open`, `message`, `ping`, …) so no engine.io type code is written
 *   down here.
 * - `socket.io-parser` — the protocol layer. `Encoder` builds the bytes that go
 *   out, `Decoder` reads the bytes that come back, and `PacketType` names them,
 *   so **`CONNECT_ERROR` is identified by the parser's own constant** rather
 *   than by a `4` this file believes in.
 *
 * Both are direct dependencies of the `socket.io` server under test and are
 * declared in `package.json` so the imports are not transitive. The transport
 * is Node's global `WebSocket`, so the handshake, the upgrade and every frame
 * are real. Nothing about the protocol is invented, which is the standard
 * `libs/garage/realtime-client`'s own `offline-transport.ts` fixture set for the other
 * direction: *a double may stand in for a dependency's behaviour, never for the
 * shape of its protocol.*
 *
 * The `websocket` transport is dialled directly rather than starting on polling
 * and upgrading. That is not a shortcut around anything: engine.io accepts a
 * direct WebSocket connection, and the handshake, the CONNECT packet, the
 * CONNECT_ERROR and every event travel exactly as they do after an upgrade —
 * while a polling first leg would add engine.io's payload framing to the test
 * harness without adding a claim to the suite.
 *
 * Spec-only support code, excluded from `tsconfig.app.json` alongside
 * `src/auth/testing` and `src/testing`.
 */

import { decodePacket } from 'engine.io-parser';
import { Decoder, Encoder, PacketType } from 'socket.io-parser';
import type { Packet } from 'socket.io-parser';
import { SOCKET_IO_PATH } from '@garage/contract/realtime';

/** How long any `waitFor…` helper waits before failing with a diagnosis. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** One server → client event, as it came off the wire. */
export interface ReceivedEvent {
  readonly name: string;
  readonly payload: unknown;
}

/** Why the connection ended, if it did. */
export interface ConnectionRefusal {
  /** The CONNECT_ERROR packet's payload — what the gateway chose to send. */
  readonly error: unknown;
}

export interface RealtimeTestClientOptions {
  /** `http://127.0.0.1:<port>` of the running API. */
  readonly baseUrl: string;
  /** Goes into `handshake.auth`. Omit entirely to send `{}`, as the real client does. */
  readonly token?: string | undefined;
  /**
   * Anything else to put in the handshake `auth` object — used by the test that
   * proves a token in the *query string* is not accepted.
   */
  readonly auth?: Record<string, unknown>;
  /** Appended to the connection URL's query string. */
  readonly query?: Record<string, string>;
}

/**
 * A connected — or refused — peer.
 *
 * Every method resolves against something that actually arrived; none of them
 * sleeps for a guessed interval.
 */
export class RealtimeTestClient {
  private readonly socket: WebSocket;
  private readonly encoder = new Encoder();
  private readonly decoder = new Decoder();

  private readonly events: ReceivedEvent[] = [];
  private readonly acks = new Map<number, (data: unknown[]) => void>();
  private nextAckId = 0;

  private connected = false;
  /** The server's id for this socket, from the CONNECT packet it answered with. */
  private sid: string | null = null;
  private refusal: ConnectionRefusal | null = null;
  private closed = false;
  private readonly waiters: (() => void)[] = [];

  private constructor(private readonly options: RealtimeTestClientOptions) {
    const query = new URLSearchParams({
      EIO: '4',
      transport: 'websocket',
      ...options.query,
    });
    // `SOCKET_IO_PATH` rather than a literal: this was the third undetected
    // copy of the server's path (`doc/decision/0113-*`) — changing the real
    // adapter's path alone used to fail nothing here, because this literal
    // agreed with the *old* value by coincidence, not by import.
    const url = `${options.baseUrl.replace(/^http/, 'ws')}${SOCKET_IO_PATH}/?${query.toString()}`;
    this.socket = new WebSocket(url);

    this.decoder.on('decoded', (packet: Packet) => {
      this.onProtocolPacket(packet);
    });

    this.socket.addEventListener('message', (event: MessageEvent) => {
      this.onFrame(String(event.data));
    });
    this.socket.addEventListener('close', () => {
      this.closed = true;
      this.wake();
    });
    // A failed WebSocket upgrade (a wrong path, a CORS-rejected origin) is a
    // close, not a protocol packet — recorded so `waitForRefusal` can tell it
    // apart from a CONNECT_ERROR rather than timing out on both.
    this.socket.addEventListener('error', () => {
      this.closed = true;
      this.wake();
    });
  }

  /** Dials the gateway and returns once it has either connected or been refused. */
  static async connect(options: RealtimeTestClientOptions): Promise<RealtimeTestClient> {
    const client = new RealtimeTestClient(options);
    await client.settled();
    return client;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** This socket's server-side id, so a spec can look it up in the server's own maps. */
  get socketId(): string | null {
    return this.sid;
  }

  /** The CONNECT_ERROR payload, or `null` if the handshake was accepted. */
  get refusedWith(): ConnectionRefusal | null {
    return this.refusal;
  }

  /** Every server → client event received so far, in arrival order. */
  get received(): readonly ReceivedEvent[] {
    return this.events;
  }

  /** Sends a client → server command with no acknowledgement. */
  emit(name: string, payload: unknown): void {
    this.send({ type: PacketType.EVENT, nsp: '/', data: [name, payload] });
  }

  /**
   * Sends a command and waits for its acknowledgement.
   *
   * The ack id is the protocol's own correlation, encoded by `socket.io-parser`
   * and matched by it on the way back — so an ack that arrives for a *different*
   * request cannot satisfy this call.
   */
  async emitWithAck(
    name: string,
    payload: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<unknown> {
    const id = this.nextAckId++;
    const answer = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acks.delete(id);
        reject(new Error(`No acknowledgement for "${name}" within ${timeoutMs}ms`));
      }, timeoutMs);
      this.acks.set(id, (data) => {
        clearTimeout(timer);
        resolve(data[0]);
      });
    });
    this.send({ type: PacketType.EVENT, nsp: '/', data: [name, payload], id });
    return answer;
  }

  /**
   * Resolves with the first matching event of this name to arrive (past or
   * future).
   *
   * `matches` exists because a suite running against a short lock TTL sees
   * `cell:unlocked` for cells other tests left behind, and an assertion that
   * accepted any of them would pass for the wrong reason.
   */
  async waitForEvent(
    name: string,
    matches: (payload: never) => boolean = () => true,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<unknown> {
    const found = await this.until(
      () => this.events.find((event) => event.name === name && matches(event.payload as never)),
      timeoutMs,
      `event "${name}" (received: ${this.events.map((e) => e.name).join(', ') || 'nothing'})`
    );
    return found.payload;
  }

  /**
   * Asserts nothing of this name arrives within `windowMs`.
   *
   * A negative claim needs a window, and this is the one place in the harness
   * that waits on a clock rather than on an arrival. It is used only for
   * "this client is not in that room", where the positive half of the same
   * assertion — another client *did* receive it — is what makes the window
   * meaningful.
   */
  async expectNoEvent(name: string, windowMs = 250): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    const seen = this.events.filter((event) => event.name === name);
    if (seen.length > 0) {
      throw new Error(`Expected no "${name}", but ${seen.length} arrived`);
    }
  }

  /** Closes the underlying socket, as a closed browser tab would. */
  async disconnect(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.socket.close();
    await this.until(
      () => (this.closed ? true : undefined),
      DEFAULT_TIMEOUT_MS,
      'the socket to close'
    );
  }

  private send(packet: Packet): void {
    for (const encoded of this.encoder.encode(packet)) {
      // engine.io wraps every protocol packet in a `message` frame. Built by
      // hand rather than through `encodePacket` because that API is
      // callback-based for binary support this test never uses; the `'4'`
      // prefix is asserted against `decodePacket`'s own naming in
      // `realtime-protocol.spec.ts`.
      this.socket.send(`4${String(encoded)}`);
    }
  }

  private onFrame(raw: string): void {
    const frame = decodePacket(raw, 'arraybuffer');
    if (frame.type === 'ping') {
      // engine.io's heartbeat. Unanswered, the server closes the connection
      // mid-test after `pingTimeout`.
      this.socket.send('3');
      return;
    }
    if (frame.type !== 'message') {
      return;
    }
    this.decoder.add(frame.data);
  }

  private onProtocolPacket(packet: Packet): void {
    switch (packet.type) {
      case PacketType.CONNECT:
        this.connected = true;
        // The server sends `{ sid }` in the CONNECT packet — this socket's id
        // on the server, which is what `Namespace.sockets` is keyed by.
        this.sid = (packet.data as { sid?: string } | undefined)?.sid ?? null;
        break;
      case PacketType.CONNECT_ERROR:
        this.refusal = { error: packet.data };
        break;
      case PacketType.EVENT: {
        const [name, payload] = packet.data as [string, unknown];
        this.events.push({ name, payload });
        break;
      }
      case PacketType.ACK: {
        const resolve = packet.id === undefined ? undefined : this.acks.get(packet.id);
        if (resolve !== undefined && packet.id !== undefined) {
          this.acks.delete(packet.id);
          resolve(packet.data as unknown[]);
        }
        break;
      }
      default:
        break;
    }
    this.wake();
  }

  /**
   * Sends the CONNECT packet once engine.io has opened, then waits for the
   * gateway's answer.
   *
   * The token goes in the CONNECT packet's `data` — which is what
   * `socket.handshake.auth` *is* on the server — and nowhere else.
   */
  private async settled(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('The WebSocket never opened'));
      }, DEFAULT_TIMEOUT_MS);
      this.socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      this.socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('The WebSocket upgrade failed'));
        },
        { once: true }
      );
    });

    this.sendConnect();
    await this.until(
      () => (this.connected || this.refusal !== null || this.closed ? true : undefined),
      DEFAULT_TIMEOUT_MS,
      'the gateway to accept or refuse the handshake'
    );
  }

  private sendConnect(): void {
    const auth = {
      ...(this.options.auth ?? {}),
      ...(this.options.token === undefined ? {} : { token: this.options.token }),
    };
    this.send({
      type: PacketType.CONNECT,
      nsp: '/',
      data: Object.keys(auth).length === 0 ? undefined : auth,
    });
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter();
    }
  }

  private async until<T>(read: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = read();
      if (value !== undefined) {
        return value;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}
