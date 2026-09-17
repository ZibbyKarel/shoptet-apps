/**
 * Schema validation of everything the socket delivers.
 *
 * The gateway validates every inbound *command* against
 * `CLIENT_TO_SERVER_EVENT_SCHEMAS` (Task 15, `libs/garage/contract/src/realtime/commands.ts`).
 * This file is the mirror of that rule on the browser side: **nothing that
 * arrives over the socket reaches a component before it has been parsed by the
 * schema the contract registers for it.**
 *
 * The reason is not symmetry. A Socket.io payload is untyped at runtime —
 * `ServerToClientEvents` is a compile-time map, and `socket.on('cell:locked',
 * handler)` will hand `handler` whatever bytes arrived, cast. A server one
 * deploy ahead, a proxy that mangles a frame, or simply a bug produces a value
 * that TypeScript swears is a `CellLockedEvent` and is not. Parsing turns that
 * into a dropped event instead of a `TypeError` three components deep.
 *
 * Invalid payloads are **dropped, not thrown**: one malformed broadcast must
 * not take down a page that is otherwise working. They are surfaced through
 * {@link InvalidRealtimePayload} so the app can decide what to do; this lib
 * never logs, because the payloads it handles sit on the same socket as the
 * access token and a "helpful" dump is how a credential ends up in a console.
 */

import type * as z from 'zod';
import {
  CLIENT_TO_SERVER_ACK_SCHEMAS,
  SERVER_TO_CLIENT_EVENT_SCHEMAS,
} from '@garage/contract/realtime';
import type { AcknowledgedEventName, ServerToClientEventName } from '@garage/contract/realtime';

/** Payload of one server → client event, derived from its schema. */
export type ServerEventPayload<K extends ServerToClientEventName> = z.infer<
  (typeof SERVER_TO_CLIENT_EVENT_SCHEMAS)[K]
>;

/** Payload of one command's acknowledgement, derived from its schema. */
export type AckPayload<K extends AcknowledgedEventName> = z.infer<
  (typeof CLIENT_TO_SERVER_ACK_SCHEMAS)[K]
>;

/**
 * What the socket delivered and why it was rejected.
 *
 * `issues` is Zod's own path/message list and nothing else — deliberately not
 * the payload, which may name users. There is no token on this path either
 * way, and keeping the report shape narrow is what makes it safe to hand
 * straight to a logger in `apps/garage/web`.
 */
export interface InvalidRealtimePayload {
  /** Contract event or command name the payload arrived under. */
  readonly event: string;
  /** `path: message` for each Zod issue. */
  readonly issues: readonly string[];
}

/** Called when a payload fails its schema. */
export type InvalidPayloadHandler = (report: InvalidRealtimePayload) => void;

export type ParseResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly report: InvalidRealtimePayload };

function describeIssues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
}

/**
 * Parses a server → client event payload against the schema the contract
 * registers for that event name.
 *
 * The lookup goes through the registry rather than a `switch`, so an event
 * added to the contract is validated here the moment it is added — there is no
 * second list to forget to extend.
 */
export function parseServerEvent<K extends ServerToClientEventName>(
  event: K,
  payload: unknown
): ParseResult<ServerEventPayload<K>> {
  const result = SERVER_TO_CLIENT_EVENT_SCHEMAS[event].safeParse(payload);
  return result.success
    ? { ok: true, data: result.data as ServerEventPayload<K> }
    : { ok: false, report: { event, issues: describeIssues(result.error) } };
}

/**
 * Parses a command acknowledgement — `cell:lock`'s, today.
 *
 * An ack is inbound data like any broadcast: it is whatever the server chose
 * to pass to the callback, and `useCellLock` reads `expiresAt` out of it to
 * schedule the heartbeat. An unparsed ack is a `setTimeout(NaN)` waiting to
 * happen.
 */
export function parseAck<K extends AcknowledgedEventName>(
  event: K,
  payload: unknown
): ParseResult<AckPayload<K>> {
  const result = CLIENT_TO_SERVER_ACK_SCHEMAS[event].safeParse(payload);
  return result.success
    ? { ok: true, data: result.data as AckPayload<K> }
    : { ok: false, report: { event, issues: describeIssues(result.error) } };
}
