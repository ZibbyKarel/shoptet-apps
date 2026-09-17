/**
 * The Socket.io connection, typed from `@garage/contract/realtime`.
 *
 * This is the only file in the workspace allowed to import `socket.io-client`
 * (`eslint.config.mjs` → `WRAPPED_LIBRARIES`; `doc/wrappers.md`). Everything
 * else — feature code, the hooks in this lib's own `connection.tsx` and
 * `cell-lock.ts` — goes through {@link RealtimeSocket}, whose every event name
 * and payload type is derived from the contract's schema registries. An event
 * the contract does not declare is not an event this type will let anybody
 * emit or listen for.
 *
 * ## The handshake token
 *
 * The access token travels in `socket.handshake.auth.token`, **never** in the
 * connection URL's query string. A query string is written to proxy and server
 * access logs verbatim, and an access token in a log file is an access token
 * that outlives its session. `doc/decision/0060-*` records the choice; the ban
 * is exercised by `socket.spec.ts`, which reads the URI the real client would
 * dial and asserts no token appears in it.
 *
 * ## Why `auth` is a function, not an object
 *
 * Socket.io calls `auth` on **every** engine open — the first connect and
 * every reconnect alike (`Socket.onopen` in `socket.io-client`, which is bound
 * to the manager's `open` event for the life of the socket). An object would
 * be read once, at construction, and the socket would then spend the rest of
 * its life re-presenting a token that expires; the function form re-reads
 * {@link RealtimeSocketOptions.getAccessToken} each time, which is the same
 * per-request seam `libs/shared/api-client` uses for its `Authorization` header and
 * the reason `libs/garage/auth`'s `useAccessTokenProvider` returns a function rather
 * than a string.
 *
 * **That is a guarantee about reconnects, not about the connection.** The token
 * is checked once per handshake and never again: an **established** socket is
 * not re-authenticated, so a session revoked or a token expired mid-connection
 * keeps receiving room broadcasts until the transport drops. That is a decision,
 * with its reasoning and its revisit conditions in `doc/decision/0296-*` — the
 * short version is that the exposure is a day room's broadcasts, which are
 * already visible to everyone in the room, and that every action a socket can
 * take is separately authorised on the API side.
 */

import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@garage/contract/realtime';
import { SOCKET_IO_PATH } from '@garage/contract/realtime';
import type { AccessTokenProvider } from '@garage/api-client';

/**
 * A connection to the parking gateway.
 *
 * The two contract maps are **reversed** relative to the server's
 * `Server<ClientToServerEvents, ServerToClientEvents>`: what the server
 * listens for is what this client emits, and vice versa.
 */
export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Where Socket.io's HTTP endpoint lives.
 *
 * Re-exported under this lib's own name for callers that already import it
 * from here, but the value comes from `@garage/contract/realtime`'s
 * `SOCKET_IO_PATH` — the one constant `apps/garage/api`'s `RealtimeIoAdapter` and this
 * client both dial (`doc/decision/0113-*`). `socket.spec.ts` asserts the
 * socket this function builds is actually configured with the contract's
 * export, not a private literal, which is the half of the cross-halves
 * guarantee this project can enforce from `libs/garage/realtime-client` — the other
 * half is `apps/garage/api/src/realtime/realtime-io.adapter.spec.ts`.
 */
export const DEFAULT_SOCKET_PATH: string = SOCKET_IO_PATH;

export interface RealtimeSocketOptions {
  /** Origin of the API, e.g. `https://api.example.test`. */
  readonly url: string;
  /** Socket.io endpoint path. Defaults to {@link DEFAULT_SOCKET_PATH}. */
  readonly path?: string;
  /**
   * Supplies the access token for the handshake. `libs/garage/auth`'s
   * `useAccessTokenProvider()` is the real implementation; the type is
   * imported from `@garage/api-client` rather than redeclared so that the
   * HTTP client and the socket cannot disagree about what the seam is.
   *
   * Returning `null`/`undefined`/`''` means "no session": the handshake is
   * then sent with an empty `auth` payload rather than `token: undefined`, and
   * the gateway rejects it. There is no anonymous mode.
   */
  readonly getAccessToken: AccessTokenProvider;
  /** Connect immediately. `false` is for tests and for deferred connects. */
  readonly autoConnect?: boolean;
  /**
   * Skip Socket.io's manager cache and build a fresh connection. Off in the
   * app — one manager per origin is the point of the cache — on in tests, so
   * two test cases cannot inherit each other's socket.
   */
  readonly forceNew?: boolean;
}

/**
 * The handshake payload. Deliberately just the token: anything else added here
 * is sent unauthenticated, before the gateway has decided who is calling.
 */
export interface RealtimeHandshakeAuth {
  readonly token?: string;
}

/**
 * Opens (or, with `autoConnect: false`, prepares) a connection.
 *
 * Reconnection is left at Socket.io's defaults — unlimited attempts, 1 s
 * growing to 5 s with 0.5 jitter — on purpose, and that is a recorded decision
 * rather than an unexamined default: `doc/decision/0063-*`. They are
 * exponential backoff with jitter already, restating them here would be a
 * second place to keep in sync, and the part of reconnection this project
 * actually has an opinion about is *what a reconnect re-sends*, which is the
 * `auth` callback below.
 *
 * Those defaults govern **transport** failures only. A handshake the gateway
 * *refuses* is not retried by socket.io at all — it destroys the socket — and
 * is handled with a deliberately bounded policy one layer up, in
 * `connection.tsx` (`doc/decision/0061-*`).
 */
export function createRealtimeSocket(options: RealtimeSocketOptions): RealtimeSocket {
  const {
    url,
    path = DEFAULT_SOCKET_PATH,
    getAccessToken,
    autoConnect = true,
    forceNew = false,
  } = options;

  return io(url, {
    path,
    autoConnect,
    forceNew,
    // No `query` and no `extraHeaders`: see the file header. The token has
    // exactly one route to the server, and it is this callback.
    auth: (cb) => {
      void Promise.resolve(getAccessToken()).then(
        (token) => cb(toHandshakeAuth(token)),
        // A provider that rejects is a session that could not be read. Hand
        // the gateway an empty handshake and let it refuse the connection —
        // swallowing the failure into a *successful* anonymous connect would
        // be a silent downgrade. The reason is deliberately not logged here:
        // it can carry the token that failed to refresh.
        () => cb({})
      );
    },
  });
}

/**
 * Normalises whatever the provider returned into the handshake payload.
 *
 * Exported for `socket.spec.ts`, which asserts the empty-session case produces
 * an object with no `token` key at all rather than `{ token: undefined }` —
 * the latter serialises to `{"token":null}` over the wire and would reach the
 * gateway as a present-but-null credential.
 */
export function toHandshakeAuth(token: string | null | undefined): RealtimeHandshakeAuth {
  return token == null || token === '' ? {} : { token };
}
