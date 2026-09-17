/**
 * `@garage/contract` — the API entry point of the contract lib.
 *
 * Task 3 exports the shared entity schemas and the error contract; Task 4 adds
 * the oRPC procedures under `src/api`.
 *
 * `schemas/` holds what both entry points share, so it is exported first;
 * `api/` builds the procedures on top of it.
 *
 * **`src/realtime` is deliberately not re-exported here.** The Socket.io half
 * of the contract has its own entry point, `@garage/contract/realtime`, so
 * that it can stay free of `@orpc/contract`; barrelling it in from here would
 * undo that in a single line. See `src/realtime/index.ts` and its
 * `no-orpc.spec.ts`.
 */
export * from './schemas';
export * from './api';
