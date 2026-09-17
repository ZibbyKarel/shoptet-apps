/**
 * The connection: who owns the socket, how its lifetime is bounded, and how a
 * component subscribes to a contract event without ever naming
 * `socket.io-client`.
 *
 * Three pieces, and the split is deliberate:
 *
 * - {@link useRealtimeConnection} **creates** the socket and owns its
 *   lifetime. Exactly one call per app.
 * - {@link RealtimeProvider} is that hook plus a context, so the rest of the
 *   tree can reach the same connection. It is what `apps/garage/web` renders
 *   (Task 23), alongside `QueryProvider`, `AuthProvider` and `IntlProvider`.
 * - {@link useRealtimeEvent}, {@link useDayRoom} and `useCellLock` **read**
 *   the context. They never create a socket, so no feature can accidentally
 *   open a second connection by rendering a component twice.
 *
 * Like `QueryProvider` and `AuthProvider`, this file carries no `'use client'`
 * directive: `apps/garage/web` marks its own provider boundary as a client component
 * and composes all of them there.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { DayRoomCommand, ServerToClientEventName } from '@garage/contract/realtime';
import type { AccessTokenProvider } from '@garage/api-client';
import { DEFAULT_SOCKET_PATH, createRealtimeSocket } from './socket';
import type { RealtimeSocket } from './socket';
import { parseServerEvent } from './validation';
import type { InvalidPayloadHandler, ServerEventPayload } from './validation';

/**
 * What the connection looks like to a component.
 *
 * `connecting` covers the first attempt and every **transport** retry:
 * Socket.io's reconnection loop reports those as `connect_error` and keeps
 * trying, and a UI that distinguished "still connecting" from "retrying after
 * a dropped transport" would be showing the user a difference they cannot act
 * on.
 *
 * `rejected` is the case that is genuinely different and used to be hidden
 * inside `connecting`: the gateway **refused the handshake**. Socket.io sends
 * a CONNECT_ERROR packet, and `Socket.onpacket` calls `destroy()` before
 * emitting `connect_error` — the socket loses its manager subscriptions and
 * will never present a token again. There is nothing left to wait for, so this
 * lib builds a **new** socket rather than waiting on a dead one; see
 * {@link REJECTED_RETRY_DELAYS_MS} and {@link RealtimeConnection.reconnect},
 * and `doc/decision/0061-*`.
 */
export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected' | 'rejected';

/**
 * How long to wait before rebuilding a socket the gateway refused, one entry
 * per automatic attempt.
 *
 * A refused handshake is almost always a stale access token — the tab was
 * backgrounded, `libs/garage/auth`'s rotation had not run yet — and rebuilding the
 * socket re-runs the `auth` callback, which re-reads the provider and so picks
 * up whatever token exists *now*. That is the recovery.
 *
 * It is a short, finite list rather than an unbounded loop because the other
 * reason a handshake is refused is that this user is genuinely not allowed in,
 * and re-presenting a credential the gateway just rejected is a request that
 * cannot succeed. Three attempts spread over ~36 s cover a rotation in flight;
 * after that the status stays `rejected` until something asks again, which is
 * what {@link RealtimeConnection.reconnect} is for. The counter resets on every
 * successful connect.
 */
export const REJECTED_RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 30_000];

export interface RealtimeConnection {
  readonly status: RealtimeStatus;
  /**
   * Throws away the current socket and builds a fresh one, re-running the
   * handshake `auth` callback — so a token that has been refreshed since is
   * the one presented.
   *
   * This is the affordance behind a "Připojit znovu" control on a `rejected`
   * status: the automatic attempts are deliberately finite, and this is how a
   * user who has just signed back in gets a connection without reloading the
   * page. Referentially stable.
   */
  readonly reconnect: () => void;
  /**
   * Reports a payload that failed its schema. Referentially stable, so an
   * effect may depend on it. Calls whatever `onInvalidPayload` the provider
   * was last rendered with — which always exists, because the prop is
   * required.
   */
  readonly reportInvalidPayload: InvalidPayloadHandler;
}

/**
 * {@link RealtimeConnection} plus the socket.io socket underneath it.
 *
 * **Not exported from `src/index.ts`, deliberately.** `socket.io-client`'s
 * `Socket` is the object this whole wrapper exists so that application code
 * never touches, and the ESLint ban (`WRAPPED_LIBRARIES`) is on the *import* —
 * it cannot see a `Socket` handed out through a re-exported type. Every
 * consumer of `useRealtime()` in `apps/garage/web` destructures `status` and
 * `reconnect` and nothing else; its specs already stub the hook as exactly
 * that. The three hooks below, and `useCellLock`, are the code that genuinely
 * needs the socket, and they are all inside this lib.
 */
export interface RealtimeInternals extends RealtimeConnection {
  /** `null` until the connection effect has run, and while disabled. */
  readonly socket: RealtimeSocket | null;
}

export interface RealtimeConnectionOptions {
  /** Origin of the API, e.g. `https://api.example.test`. */
  readonly url: string;
  /** Socket.io endpoint path. Defaults to {@link DEFAULT_SOCKET_PATH}. */
  readonly path?: string;
  /** Where the handshake token comes from — `libs/garage/auth`'s provider. */
  readonly getAccessToken: AccessTokenProvider;
  /**
   * Hold the connection closed. The app passes `status === 'authenticated'`:
   * connecting before a session exists just spends a handshake the gateway is
   * going to refuse.
   */
  readonly enabled?: boolean;
  /**
   * Called for each payload that fails its contract schema.
   *
   * **Required, on purpose.** This lib drops a refused payload rather than
   * throwing — one malformed broadcast must not take a working page down — so
   * this callback is the only trace the drop leaves anywhere. When it was
   * optional the lib had a silent mode that type-checked and linted: a
   * consumer that never passed it would show a board that quietly stopped
   * updating, with the socket still `connected`, so no status UI said anything
   * either. `libs/garage/realtime-client` is the mandatory wrapper for
   * `socket.io-client`, so every future consumer arrives through here and
   * inherited that default.
   *
   * The lib does not supply a default itself: `validation.ts` states the
   * invariant that this lib never logs (its payloads share a socket with the
   * access token), and `no-console` is an error across `libs/**`. So the
   * decision belongs to the consumer — and requiring the prop makes a consumer
   * that wants silence write it down, where it is greppable and reviewable,
   * instead of getting it by omission.
   */
  readonly onInvalidPayload: InvalidPayloadHandler;
}

/**
 * Creates and owns one connection for as long as the calling component is
 * mounted.
 *
 * The socket is built inside an effect rather than during render, and torn
 * down by that effect's cleanup: a socket opened in a render body would leak
 * one connection per discarded render, and React's development double-invoke
 * would leave the first one open forever.
 *
 * `getAccessToken` and `onInvalidPayload` are read through refs, so passing an
 * inline arrow — which every caller will — does not tear the socket down and
 * rebuild it on every render. Only `url`, `path` and `enabled` do that, which
 * is right: they are the connection's identity — plus one internal
 * `generation` counter, which is how a refused handshake is recovered from
 * (see {@link RealtimeStatus} and {@link REJECTED_RETRY_DELAYS_MS}).
 */
export function useRealtimeConnection(options: RealtimeConnectionOptions): RealtimeInternals {
  const {
    url,
    path = DEFAULT_SOCKET_PATH,
    getAccessToken,
    enabled = true,
    onInvalidPayload,
  } = options;

  const getAccessTokenRef = useRef(getAccessToken);
  const onInvalidPayloadRef = useRef(onInvalidPayload);

  // Written during render on purpose, the same way `libs/garage/auth`'s
  // `useAccessTokenProvider` does it: neither ref is read while rendering,
  // only from a callback, and an effect would leave the socket one commit
  // behind — long enough for a reconnect to present the previous token.
  getAccessTokenRef.current = getAccessToken;
  onInvalidPayloadRef.current = onInvalidPayload;

  const [socket, setSocket] = useState<RealtimeSocket | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');

  // Bumping this rebuilds the socket. It is the only way back from a refused
  // handshake: `socket.io-client` destroys the socket it refused, so there is
  // no `connect()` to call — the recovery is a new socket, which re-runs the
  // `auth` callback and so presents whatever token the provider has now.
  const [generation, setGeneration] = useState(0);
  // Consecutive refusals, kept in a ref so it survives the rebuild it causes.
  const refusalsRef = useRef(0);

  const reconnect = useCallback(() => {
    refusalsRef.current = 0;
    setGeneration((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const next = createRealtimeSocket({
      url,
      path,
      autoConnect: true,
      // This hook owns the socket's lifetime, so it must not be handed one out
      // of Socket.io's per-origin manager cache: a cached manager outlives the
      // component that disconnected it, and a remount would revive a socket
      // whose listeners belong to an unmounted tree.
      forceNew: true,
      getAccessToken: () => getAccessTokenRef.current(),
    });

    let retry: ReturnType<typeof setTimeout> | undefined;

    const onConnect = () => {
      // A connection that worked means the credential worked, so the next
      // refusal starts its budget over.
      refusalsRef.current = 0;
      setStatus('connected');
    };
    const onDisconnect = () => setStatus('disconnected');
    // `connect_error` covers two very different failures, and `socket.active`
    // is what tells them apart — it is `!!socket.subs`, and the CONNECT_ERROR
    // branch of `Socket.onpacket` calls `destroy()`, which clears `subs`.
    //
    //   active  — a transport that could not be established. Socket.io's
    //             reconnect timer will try again by itself; still `connecting`.
    //   !active — the gateway refused the handshake and the client destroyed
    //             the socket. Nothing will ever retry it, so reporting
    //             `connecting` would pin the UI on a connection that is not
    //             coming. It is a terminal `rejected`, and the recovery is a
    //             new socket with a freshly read token.
    //
    // The error itself is deliberately neither logged nor surfaced: for an
    // auth failure it is the gateway's rejection of the token that just
    // travelled, and this lib does not put anything from that exchange into a
    // log.
    const onConnectError = () => {
      if (next.active) {
        setStatus('connecting');
        return;
      }

      setStatus('rejected');
      const delay = REJECTED_RETRY_DELAYS_MS[refusalsRef.current];
      refusalsRef.current += 1;
      // Out of automatic attempts: stay `rejected` and wait for `reconnect()`.
      if (delay === undefined) return;
      retry = setTimeout(() => setGeneration((n) => n + 1), delay);
    };

    next.on('connect', onConnect);
    next.on('disconnect', onDisconnect);
    next.on('connect_error', onConnectError);

    setSocket(next);
    setStatus(next.connected ? 'connected' : 'connecting');

    return () => {
      if (retry !== undefined) clearTimeout(retry);
      next.off('connect', onConnect);
      next.off('disconnect', onDisconnect);
      next.off('connect_error', onConnectError);
      next.disconnect();
      setSocket(null);
      setStatus('disconnected');
    };
  }, [url, path, enabled, generation]);

  const reportInvalidPayload = useCallback<InvalidPayloadHandler>((report) => {
    onInvalidPayloadRef.current(report);
  }, []);

  return useMemo(
    () => ({ socket, status, reconnect, reportInvalidPayload }),
    [socket, status, reconnect, reportInvalidPayload]
  );
}

const RealtimeContext = createContext<RealtimeInternals | null>(null);

export interface RealtimeProviderProps extends RealtimeConnectionOptions {
  readonly children: ReactNode;
}

/** The single place components attach to the realtime connection. */
export function RealtimeProvider({ children, ...options }: RealtimeProviderProps) {
  const connection = useRealtimeConnection(options);
  return <RealtimeContext.Provider value={connection}>{children}</RealtimeContext.Provider>;
}

/**
 * The connection a {@link RealtimeProvider} ancestor established.
 *
 * Throws rather than returning `null` when there is no provider: a component
 * that silently does nothing because it is outside the tree is a bug that only
 * shows up as "realtime updates stopped working" in production.
 */
export function useRealtime(): RealtimeConnection {
  return useRealtimeInternals();
}

/**
 * The same connection, with the socket. For this lib's own hooks only — see
 * {@link RealtimeInternals} for why the socket does not leave here.
 */
export function useRealtimeInternals(): RealtimeInternals {
  const connection = useContext(RealtimeContext);
  if (connection === null) {
    throw new Error('useRealtime must be used inside a <RealtimeProvider>.');
  }
  return connection;
}

/**
 * Subscribes to one server → client event for as long as the component is
 * mounted, handing the handler a payload that has been through the contract
 * schema (`./validation`). A payload that fails is dropped and reported; the
 * handler is not called with it.
 *
 * `handler` is read through a ref, so an inline arrow does not re-subscribe on
 * every render.
 */
export function useRealtimeEvent<K extends ServerToClientEventName>(
  event: K,
  handler: (payload: ServerEventPayload<K>) => void
): void {
  const { socket, reportInvalidPayload } = useRealtimeInternals();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (socket === null) return;

    const listener = (payload: unknown) => {
      const result = parseServerEvent(event, payload);
      if (!result.ok) {
        reportInvalidPayload(result.report);
        return;
      }
      handlerRef.current(result.data);
    };

    socket.on(event, listener as never);
    return () => {
      socket.off(event, listener as never);
    };
  }, [socket, event, reportInvalidPayload]);
}

/**
 * Joins the room of one day, and rejoins it after every reconnect.
 *
 * Rejoining is not extra logic — it falls out of the effect depending on
 * `status`. A dropped socket loses its server-side room membership, so the
 * subscription has to be re-sent on the new connection or the client goes
 * quietly deaf. Gating on `connected` (rather than emitting eagerly and
 * letting Socket.io buffer) is what makes the re-send happen at all: a
 * buffered `day:subscribe` from the *previous* connection is flushed on the
 * new one, which looks the same until the buffer was cleared by the
 * disconnect.
 *
 * `date` is `null` when there is no day to watch — a page still deciding which
 * one to show.
 */
export function useDayRoom(date: DayRoomCommand['date'] | null): void {
  const { socket, status } = useRealtimeInternals();

  useEffect(() => {
    if (socket === null || date === null || status !== 'connected') return;

    socket.emit('day:subscribe', { date });
    return () => {
      // Only while the socket is still up: once it is down the room is gone
      // anyway, and Socket.io would buffer the `day:unsubscribe` and deliver
      // it on the next connection, where it means something else entirely.
      if (socket.connected) socket.emit('day:unsubscribe', { date });
    };
  }, [socket, status, date]);
}
