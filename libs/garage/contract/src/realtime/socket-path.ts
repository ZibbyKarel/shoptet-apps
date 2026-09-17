/**
 * Where Socket.io's HTTP endpoint lives — one constant, shared by both halves
 * of the wire.
 *
 * `apps/garage/api`'s `RealtimeIoAdapter` (`realtime-io.adapter.ts`) configures the
 * real `socket.io` `Server` with this value, and `libs/garage/realtime-client`'s
 * `createRealtimeSocket` (`socket.ts`, re-exported as `DEFAULT_SOCKET_PATH`)
 * dials it. Before `doc/decision/0113-*` this was two independent literals —
 * `apps/garage/api`'s own `SOCKET_IO_PATH` and the client's `DEFAULT_SOCKET_PATH` —
 * because `apps/garage/api` (`scope:api`) cannot import `libs/garage/realtime-client`
 * (`scope:web`; its entry point pulls React in, so
 * `@nx/enforce-module-boundaries` is right to refuse it). Two literals that
 * happen to agree are not a guarantee: changing one alone failed nothing on
 * either side, and a Socket.io path mismatch between server and browser is a
 * **total realtime outage that no unit test catches** — every handshake
 * fails the WebSocket upgrade before the gateway's own authentication ever
 * runs.
 *
 * `@garage/contract/realtime` is `scope:shared` and both halves already
 * import it for the event registries, so it is the one place a wire-protocol
 * constant like this can live without inventing a new dependency edge. The
 * value itself is unchanged — it is Socket.io's own default — only its
 * *home* moved.
 *
 * Neither half is allowed to quietly go back to a private literal: the
 * adapter's `realtime-io.adapter.spec.ts` and the client's `socket.spec.ts`
 * each assert their own configured path against *this* export, so a literal
 * reintroduced on either side fails that side's own suite immediately,
 * rather than staying invisible until both processes are deployed and
 * disagree.
 */
export const SOCKET_IO_PATH = '/socket.io';
