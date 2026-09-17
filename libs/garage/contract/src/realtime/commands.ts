/**
 * Payload schemas of the **client → server** realtime commands.
 *
 * This is the security-relevant half of the realtime contract: these payloads
 * arrive from a browser and are, until validated, attacker-controlled. The rule
 * the gateway implements (Task 15) and `doc/contract.md` records is therefore
 * absolute: **the server validates every inbound client event against the
 * schema registered for it, and drops the event if validation fails.** No
 * handler ever sees a raw payload.
 *
 * For that rule to be *total* rather than aspirational, three things hold here:
 *
 * 1. Every command has a schema, and the schema registry in `./event-maps` is
 *    what `ClientToServerEvents` is derived from — a command with no schema is
 *    not a command the type system will let a gateway declare a handler for.
 * 2. No schema uses `z.any()`, `z.unknown()`, `z.record()` or a passthrough
 *    object. Every field is a closed shape; unknown keys are stripped.
 * 3. The surface is as small as it can be. Four commands, two payload shapes.
 *    Anything a client could ask for over the API is *not* here — you cannot
 *    create or cancel a reservation over the socket. The socket carries
 *    subscriptions and the editing hold, nothing that mutates domain state.
 *
 * Commands are named in the **imperative** (`cell:lock`), against the past
 * participle of the events they may cause (`cell:locked`), so the direction of
 * an event is readable from its name alone.
 */

import * as z from 'zod';
import { CELL_LOCK_RESULTS } from '@garage/shared-types';
import { userSummarySchema } from '../schemas/entities';
import { dateOnlySchema, timestampSchema } from '../schemas/primitives';
import { cellRefSchema } from './events';

/**
 * `day:subscribe` / `day:unsubscribe` — join or leave the room of one day.
 *
 * `strictObject`, not `object`: a stray key in a subscription request is a
 * client that disagrees with this contract about what a subscription is, and
 * silently stripping it would hide the disagreement. The events going the other
 * way stay lenient (unknown keys stripped) because a client must tolerate a
 * server that has been deployed ahead of it; the server has no such duty.
 */
export const dayRoomCommandSchema = z.strictObject({
  date: dateOnlySchema,
});
export type DayRoomCommand = z.infer<typeof dayRoomCommandSchema>;

/**
 * `cell:lock` — ask for the short-lived editing hold on one cell, and
 * `cell:unlock` — give it back.
 *
 * There is no separate heartbeat command. Re-sending `cell:lock` for a cell the
 * caller already holds **extends** the TTL (Task 15: "TTL ~30 s a prodlužování"),
 * which is the heartbeat — one command fewer on the inbound surface, and an
 * idempotent one, so a client that loses track of its own state cannot corrupt
 * the server's.
 */
export const cellLockCommandSchema = z.strictObject(cellRefSchema.shape);
export type CellLockCommand = z.infer<typeof cellLockCommandSchema>;

/** Outcome of a `cell:lock` request. */
export const cellLockResultSchema = z.enum(CELL_LOCK_RESULTS);
export type CellLockResult = z.infer<typeof cellLockResultSchema>;

/**
 * Acknowledgement the server sends back to the `cell:lock` caller.
 *
 * A discriminated union rather than a nullable bag, so the caller cannot read
 * `lockedBy` on a granted lock or forget to handle a denial: `ACQUIRED` carries
 * only the deadline, `HELD_BY_OTHER` carries who has it and until when — which
 * is exactly what the "právě upravuje …" state needs, and is the same
 * information the corresponding `cell:locked` broadcast carries, so a client
 * that lost the race renders identically whether it hears the ack or the
 * broadcast first.
 *
 * The lock is a **hold, not a reservation**: acquiring it does not book
 * anything. The reservation is still created over the API, which re-checks
 * everything. A client that skips the lock entirely gets a `CONFLICT` from
 * `reservation.create` instead of a nicer message — the hold is a courtesy to
 * the other user, never an authorization step.
 */
export const cellLockAckSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('ACQUIRED'),
    /** When the hold lapses unless the caller renews it. */
    expiresAt: timestampSchema,
  }),
  z.object({
    result: z.literal('HELD_BY_OTHER'),
    lockedBy: userSummarySchema,
    expiresAt: timestampSchema,
  }),
]);
export type CellLockAck = z.infer<typeof cellLockAckSchema>;
