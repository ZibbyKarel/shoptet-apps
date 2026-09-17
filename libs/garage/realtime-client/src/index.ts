/**
 * `@garage/realtime-client` — the wrapper lib that owns `socket.io-client`.
 *
 * No application or feature file may import `socket.io-client` directly
 * (`eslint.config.mjs` → `WRAPPED_LIBRARIES`, `doc/wrappers.md`); everything a
 * feature needs to watch a day, hold a cell or read a broadcast is here:
 *
 * - `RealtimeProvider` / `useRealtime` — the one connection, its handshake
 *   token, its status and its reconnect affordance;
 * - `useRealtimeEvent` / `useDayRoom` — subscribing to a day and to the events
 *   broadcast into it, each payload parsed against its contract schema first;
 * - `useCellLock` — the editing hold, renewed while a form is open and
 *   released when it closes.
 *
 * Every event name and payload type comes from `@garage/contract/realtime`.
 * There is no way to emit or listen for something the contract does not
 * declare, and no payload shape is written down twice.
 *
 * **What is deliberately not here.** `createRealtimeSocket`, `toHandshakeAuth`,
 * `parseAck`, `parseServerEvent`, `useRealtimeConnection`, the cell-lock
 * timing constants and the two delay functions are how the four hooks above
 * are built. None is named outside this lib, and the socket type they traffic
 * in is the one object the wrapper ban exists to keep out of `apps/garage/web` —
 * a ban ESLint enforces on the *import*, which a re-exported type walks
 * straight past. The lib's own specs reach them through `./lib/socket`,
 * `./lib/connection`, `./lib/validation` and `./lib/timing`.
 */

export { RealtimeProvider, useDayRoom, useRealtime, useRealtimeEvent } from './lib/connection';
export type {
  RealtimeConnection,
  RealtimeConnectionOptions,
  RealtimeProviderProps,
  RealtimeStatus,
} from './lib/connection';

export { useCellLock } from './lib/cell-lock';
export type {
  CellLockHolder,
  CellLockState,
  CellLockStatus,
  UseCellLockOptions,
} from './lib/cell-lock';

/**
 * The types `RealtimeProviderProps` is written in terms of: a consumer
 * supplying `onInvalidPayload` has to be able to name its argument.
 */
export type { InvalidPayloadHandler, InvalidRealtimePayload } from './lib/validation';
export type { ServerEventPayload } from './lib/validation';

/**
 * The token seam, re-exported from `@garage/api-client` rather than
 * redeclared.
 *
 * `libs/garage/auth`'s `useAccessTokenProvider()` returns one of these and it feeds
 * both the HTTP client's `Authorization` header and this lib's handshake. One
 * definition means the two can never drift into "the socket takes a string,
 * the client takes a function", which is precisely the drift that would make a
 * long-lived socket pin an expired token.
 */
export type { AccessTokenProvider } from '@garage/api-client';
