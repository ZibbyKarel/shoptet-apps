/**
 * Socket.io room naming.
 *
 * There is exactly **one room per reservation day**. Everything the parking
 * screen renders is scoped to a single day, so a client looking at 2026-09-15
 * joins `day:2026-09-15` and hears nothing else. A room per spot would multiply
 * the joins by the size of the lot for no gain; one global room would send
 * every day's traffic to everybody.
 *
 * The name is derived, never stored, so the gateway and the client compute it
 * independently and cannot drift apart.
 */

import { type DateOnly, assertDateOnly } from '@garage/shared-types';

/**
 * Prefix of every day room. Exported so a gateway can recognise — and a test
 * can assert — that a socket is only ever in day rooms.
 */
export const DAY_ROOM_PREFIX = 'day:';

/**
 * Room name for one reservation day: `day:YYYY-MM-DD`.
 *
 * Pure: same input, same output, no state, no I/O.
 *
 * It **throws** on anything that is not a calendar-valid `YYYY-MM-DD`, via the
 * single date-only guard in `@garage/shared-types` (`doc/decision/0003-*`).
 * A date reaching this function has normally already been validated by the
 * gateway against `dayRoomCommandSchema`, so the throw is defence in depth —
 * but it is worth having, because a room name is a broadcast target and an
 * unchecked string would let a caller address a room no legitimate client can
 * be in, or one that far too many are.
 */
export function roomForDate(date: DateOnly): string {
  assertDateOnly(date);
  return `${DAY_ROOM_PREFIX}${date}`;
}
