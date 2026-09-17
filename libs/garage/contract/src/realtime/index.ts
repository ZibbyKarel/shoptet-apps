/**
 * `@garage/contract/realtime` — the Socket.io half of the contract.
 *
 * A **separate entry point** from `@garage/contract`, and deliberately so:
 * the API entry point pulls in `@orpc/contract`, and nothing on the realtime
 * path has any business carrying an RPC contract builder — not the browser
 * bundle that only ever opens a socket, and not the gateway. Nothing under
 * `src/realtime` may import from `src/api`; both sides import the shared entity
 * schemas from `src/schemas` instead, which is also why a shape used by both
 * (`userSummarySchema`, `publicReservationSchema`) lives there.
 *
 * `src/realtime/no-orpc.spec.ts` walks the real module graph from this file and
 * fails if an `@orpc/*` import, or an import into `src/api`, ever appears —
 * `@orpc/client` is physically installed in the workspace, so lint alone is not
 * proof.
 *
 * Contents:
 *
 * - `./events`      — payload schemas of the server → client events
 * - `./commands`    — payload schemas of the client → server commands, plus the
 *                     `cell:lock` acknowledgement
 * - `./event-maps`  — the schema registries and the `ServerToClientEvents` /
 *                     `ClientToServerEvents` maps derived from them
 * - `./rooms`       — `roomForDate`, one room per day
 * - `./socket-path` — `SOCKET_IO_PATH`, the one Socket.io endpoint path both
 *                     the gateway and `libs/garage/realtime-client` dial
 */
export * from './events';
export * from './commands';
export * from './event-maps';
export * from './rooms';
export * from './socket-path';
