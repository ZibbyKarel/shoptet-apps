/**
 * The Socket.io server's own configuration, kept out of the gateway.
 *
 * Nest builds the `socket.io` `Server` through an *adapter*, and the gateway
 * only ever sees the result. That indirection is what this file is for: the two
 * things that will change when this stops being a single-instance deployment —
 * how the server is constructed, and which Socket.io adapter it broadcasts
 * through — both live here, and neither is visible from `realtime.gateway.ts`.
 *
 * ## What is set, and why it is set here rather than on `@WebSocketGateway()`
 *
 * `@WebSocketGateway({ … })`'s options reach the same `createIOServer` call, so
 * either place would work. They are here because the gateway's decorator is
 * read as "what this gateway listens for" and the server's transport
 * configuration is not that — and because a spec that wants a real server needs
 * one function to call, exactly as `configure-app.ts` exists so `main.ts` and
 * `http-pipeline.spec.ts` cannot drift.
 *
 * - **`path`** — {@link SOCKET_IO_PATH}, imported from
 *   `@garage/contract/realtime` rather than declared here. See its own
 *   comment and `doc/decision/0113-*`: `apps/garage/api` cannot import
 *   `libs/garage/realtime-client` directly (a boundary decision, not an oversight),
 *   so the contract's shared entry point is where a constant both halves of
 *   the wire protocol must agree on lives.
 * - **`cors`** — the same `CORS_ALLOWED_ORIGINS` allow-list the HTTP side uses.
 *   Socket.io needs its own: the handshake is an HTTP request served by
 *   engine.io, which never passes through Express' CORS middleware. Without it
 *   a browser on an allowed origin cannot open a socket at all — and with
 *   `origin: '*'` any page on the internet could open one carrying a user's
 *   token.
 * - **`serveClient: false`** — Socket.io otherwise serves its own browser
 *   bundle from `/socket.io/socket.io.js`. `apps/garage/web` bundles `socket.io-client`
 *   itself, so that route is only ever an unused file server.
 *
 * ## The upgrade path
 *
 * A second instance breaks broadcasting before it breaks anything else: each
 * process would only reach the sockets connected to *it*, so half the browsers
 * watching a day would never hear that a spot was taken. The fix is a Socket.io
 * adapter, and it is a change to {@link RealtimeIoAdapter.installClusterAdapter}
 * and nothing else:
 *
 * ```ts
 * // npm i @socket.io/redis-adapter redis
 * const pub = createClient({ url: REDIS_URL });
 * const sub = pub.duplicate();
 * await Promise.all([pub.connect(), sub.connect()]);
 * server.adapter(createAdapter(pub, sub));
 * ```
 *
 * Nothing in `realtime.gateway.ts`, and nothing in `libs/garage/realtime-client`,
 * changes: rooms, event names and payloads are the contract's. It is
 * deliberately **not** implemented — an unused implementation is an untested
 * one, and `LockService` would need its Redis half in the same change to be
 * worth anything (`doc/realtime.md` §"Single instance").
 */

import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplication } from '@nestjs/common';
import type { Server, ServerOptions } from 'socket.io';
import { SOCKET_IO_PATH } from '@garage/contract/realtime';
import type { ApiEnv } from '../env';

/** The slice of the environment the socket server needs. */
export type RealtimeAdapterConfig = Pick<ApiEnv, 'CORS_ALLOWED_ORIGINS'>;

export class RealtimeIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly config: RealtimeAdapterConfig
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      path: SOCKET_IO_PATH,
      serveClient: false,
      cors: {
        // An explicit allow-list, never `origin: true` and never `*` — same
        // reasoning as `configureApp`'s: the handshake carries a bearer token.
        origin: this.config.CORS_ALLOWED_ORIGINS,
        credentials: true,
        // The only two engine.io ever uses: `GET` for polling and the upgrade,
        // `POST` for a polling client's outbound frames.
        methods: ['GET', 'POST'],
      },
    }) as Server;

    this.installClusterAdapter(server);
    return server;
  }

  /**
   * Where `@socket.io/redis-adapter` goes when there is more than one instance.
   *
   * A no-op today, and named rather than left as a comment so that the upgrade
   * has a place to land and `realtime-io.adapter.spec.ts` has something to
   * assert is reached. See the file header for the full replacement.
   */
  protected installClusterAdapter(_server: Server): void {
    // Single instance (global constraint 8): Socket.io's default in-memory
    // adapter is correct, and a broker here would be infrastructure with
    // nothing to coordinate.
  }
}

/**
 * Installs the Socket.io adapter on an application.
 *
 * Called by `configureApp`, so the running server and every spec that boots the
 * assembled app get the same socket server rather than a hand-rebuilt one.
 * Must run before `init()`/`listen()`: Nest reads the adapter when it
 * instantiates gateways.
 */
export function configureRealtime(app: INestApplication, config: RealtimeAdapterConfig): void {
  app.useWebSocketAdapter(new RealtimeIoAdapter(app, config));
}
