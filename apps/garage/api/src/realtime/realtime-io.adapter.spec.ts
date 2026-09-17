/**
 * The `ServerOptions` `RealtimeIoAdapter` actually constructs.
 *
 * `realtime-handshake.spec.ts` and `realtime.gateway.spec.ts` already dial a
 * real socket against the assembled application's real adapter, but none of
 * `path`, `serveClient` or `cors.origin` is observable from a client's point of
 * view: a browser refused by CORS never gets a socket to inspect, and one that
 * connects says nothing about whether the bundled client is being served.
 * Before this file, removing `configureRealtime(app, …)` from
 * `configure-app.ts` entirely — Nest falling back to its own default
 * `IoAdapter` — failed zero of those end-to-end specs, because a default
 * `IoAdapter` still accepts connections; it would simply do so with no CORS
 * allow-list and the bundled client turned on. This file is what actually
 * pins the configuration.
 */

import { Server as HttpServer } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Server as SocketIoServer } from 'socket.io';
import { SOCKET_IO_PATH } from '@garage/contract/realtime';
import type { RealtimeAdapterConfig } from './realtime-io.adapter';
import { RealtimeIoAdapter } from './realtime-io.adapter';

const CONFIG: RealtimeAdapterConfig = {
  CORS_ALLOWED_ORIGINS: ['https://parking.example.test', 'http://localhost:4200'],
};

/**
 * Builds a real `socket.io` `Server` through the adapter, attached to a plain
 * `http.Server` that is never `listen()`ed — the same state Nest's
 * `INestApplication` is in when `useWebSocketAdapter` runs `createIOServer`,
 * before `app.listen()`. Passing that raw `http.Server` as the adapter's `app`
 * argument reproduces `AbstractWsAdapter`'s own branch for a non-`NestApplication`
 * host (`this.httpServer = appOrHttpServer`) without needing a full Nest
 * bootstrap for what is otherwise a pure configuration check.
 *
 * Because the `http.Server` is never listening, `socket.io`'s `attach()` only
 * registers `request`/`upgrade` listeners on it — no port opens, so there is
 * nothing for a test to leak. `server.close()` still runs, to release those
 * listeners and keep Jest's open-handle detection quiet.
 */
function buildServer(config: RealtimeAdapterConfig = CONFIG): {
  server: SocketIoServer;
  close: () => Promise<void>;
} {
  const httpServer = new HttpServer();
  const adapter = new RealtimeIoAdapter(httpServer as unknown as INestApplication, config);
  const server = adapter.createIOServer(0);
  return { server, close: () => server.close() };
}

/** The subset of `Server`'s otherwise-private state this suite reads. */
interface InspectableServer {
  readonly opts: {
    readonly path: string;
    readonly serveClient?: boolean;
    readonly cors?: { readonly origin: unknown; readonly credentials?: boolean };
  };
  readonly _serveClient: boolean;
}

describe('RealtimeIoAdapter', () => {
  it('serves on the contract’s shared SOCKET_IO_PATH, never a private literal', async () => {
    // The other half of the cross-halves guarantee is
    // `libs/garage/realtime-client/src/lib/socket.spec.ts`, which asserts the
    // client's configured path against this same import. Each side fails its
    // own suite the moment it stops importing `SOCKET_IO_PATH` and hardcodes a
    // literal instead — which is the only way the two halves could disagree
    // without either failing on its own.
    const { server, close } = buildServer();
    try {
      expect((server as unknown as InspectableServer).opts.path).toBe(SOCKET_IO_PATH);
    } finally {
      await close();
    }
  });

  it('does not serve the bundled socket.io.js client', async () => {
    const { server, close } = buildServer();
    try {
      expect((server as unknown as InspectableServer)._serveClient).toBe(false);
    } finally {
      await close();
    }
  });

  it('restricts CORS to the configured allow-list, never a wildcard', async () => {
    const { server, close } = buildServer();
    try {
      const cors = (server as unknown as InspectableServer).opts.cors;
      expect(cors?.origin).toEqual(CONFIG.CORS_ALLOWED_ORIGINS);
      expect(cors?.origin).not.toBe('*');
      expect(cors?.origin).not.toBe(true);
      expect(cors?.credentials).toBe(true);
    } finally {
      await close();
    }
  });

  it('reaches installClusterAdapter with the constructed server', async () => {
    const spy = jest.spyOn(
      RealtimeIoAdapter.prototype as unknown as {
        installClusterAdapter: (server: unknown) => void;
      },
      'installClusterAdapter'
    );
    const { server, close } = buildServer();
    try {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(server);
    } finally {
      spy.mockRestore();
      await close();
    }
  });
});
