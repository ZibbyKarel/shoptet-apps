/**
 * The shape of an error body on the wire — and when it is wrapped in the RPC
 * envelope.
 *
 * Separate from the filter that writes these bodies, because "what does an
 * error look like on an RPC route versus a plain one" is a question about the
 * transport contract, not about exception handling. Governed by
 * `doc/decision/0058-error-bodies-on-rpc-routes-carry-the-rpc-envelope` and
 * `doc/decision/0033-transport-errors-keep-the-nest-shape`.
 *
 * Domain errors use oRPC's error JSON (`ORPCErrorJSON` in `@orpc/client`):
 * `{ defined, code, status, message, data? }`. The frontend reads errors
 * through the oRPC client, which only understands that shape, so a body in any
 * other shape would be unreadable to it. `data` is the contract's `details`
 * under oRPC's name for the same field — see
 * `doc/decision/0018-mapping-error-contract-to-orpc.md`. `defined` is `false`
 * because an error that reached the global filter is by definition one the
 * procedure did not declare.
 *
 * Transport-level failures (an unmatched route, a throttled request, a body
 * over the size limit) keep Nest's `{ statusCode, message }` shape: they are
 * not domain errors and the closed enum has no member for them. See
 * `doc/decision/0033-*`.
 */

import { HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import type { ErrorCode, ErrorDetails } from '@garage/contract';
import { ERROR_DEFINITIONS } from '@garage/contract';
import { RPC_PATH_PREFIX } from '../../orpc/rpc-route';

/**
 * oRPC's on-the-wire error JSON. Declared structurally rather than imported:
 * `@orpc/client` is a frontend dependency and the backend has no other reason
 * to pull it in. Keep in sync with `ORPCErrorJSON` if oRPC ever changes it —
 * `error-body.spec.ts` pins every field.
 */
export interface ContractErrorBody {
  /** Always `false` here: the procedure did not declare this error. */
  defined: false;
  code: ErrorCode;
  status: number;
  message: string;
  data?: ErrorDetails;
}

/** The shape used for failures that are not domain errors. */
export interface TransportErrorBody {
  statusCode: number;
  message: string;
}

/**
 * What the client is told when nothing matched. Deliberately constant: any
 * detail here is a detail about the server's internals.
 */
export const INTERNAL_ERROR_BODY: TransportErrorBody = {
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  message: 'Internal server error',
};

/**
 * The RPC protocol's envelope.
 *
 * `@orpc/client`'s `RPCLink` deserialises a response by reading `json` out of
 * this wrapper; a body written at the top level deserialises to `undefined`,
 * fails oRPC's `isORPCErrorJson`, and the client then **synthesises a code from
 * the HTTP status** — so a 409 `SPOT_ALREADY_RESERVED` used to arrive as
 * `CONFLICT`, which is also a member of `ERROR_CODES` and therefore did not fail
 * closed: the UI would have shown the wrong domain error, confidently. Recorded
 * as known-and-unguarded in `doc/decision/0039-*`, which routed the fix to
 * whoever owned `apps/garage/api` next; that is Task 12.
 *
 * There is deliberately **no `meta` key**. `meta` is oRPC's list of type
 * annotations for values JSON cannot carry (dates, bigints, sets); an error body
 * has none, and oRPC's own serialiser drops the key entirely when the list is
 * empty (`StandardRPCSerializer#serialize`: `meta_.length === 0 ? undefined :
 * meta_`), which the client compensates for on the way back in
 * (`data.meta ?? []`). Emitting `meta: []` here would work too, but this way the
 * filter's body is byte-identical to what `RPCHandler` produces for the same
 * error — and "identical to the transport" is a property that can be checked,
 * whereas "close enough for the deserialiser" is a claim about someone else's
 * code. `orpc-pipeline.spec.ts` compares the two shapes against a live server.
 */
export interface RpcEnvelope<T> {
  json: T;
}

export function rpcEnvelope<T>(body: T): RpcEnvelope<T> {
  return { json: body };
}

/**
 * True for a request that will be read by an oRPC client.
 *
 * Scoped by path rather than applied everywhere on purpose: the health probes
 * and the ICS feed (Task 14) are read by an orchestrator and by calendar
 * clients, neither of which knows what a `{ json, meta }` envelope is.
 */
export function isRpcRequest(request: Request): boolean {
  const path = request.path;
  return path === RPC_PATH_PREFIX || path.startsWith(`${RPC_PATH_PREFIX}/`);
}

/** Builds the wire body for a contract error code. */
export function contractErrorBody(code: ErrorCode, details?: ErrorDetails): ContractErrorBody {
  const definition = ERROR_DEFINITIONS[code];
  return {
    defined: false,
    code,
    status: definition.status,
    message: definition.message,
    ...(details === undefined ? {} : { data: details }),
  };
}

/**
 * True for a `@nestjs/terminus` health-check result.
 *
 * This is the **only** 5xx body the filter forwards instead of replacing with
 * {@link INTERNAL_ERROR_BODY}, so the check is deliberately narrow: the shape is
 * built by terminus from our own indicators' `up()`/`down()` payloads, contains
 * no `Error` and no stack, and *is* the point of the endpoint — a readiness
 * probe whose body says "internal server error" tells the operator nothing.
 *
 * Everything else at 5xx still gets the constant body. In particular
 * `new InternalServerErrorException(err.message)` — the usual way an internal
 * detail escapes — produces `{ statusCode, message, error }`, which fails this
 * check on all four keys. `contract-exception.filter.spec.ts` pins that.
 */
export function isHealthCheckResult(body: unknown): boolean {
  // An `Error` reaches this arm too, and passes the narrowing below — it is a
  // non-array object. It is rejected one line later instead, on `status`, which
  // no `Error` carries.
  const result = asRecord(body);
  if (result === undefined) {
    return false;
  }
  const status = result['status'];
  return (
    (status === 'ok' || status === 'error' || status === 'shutting_down') &&
    asRecord(result['info']) !== undefined &&
    asRecord(result['error']) !== undefined &&
    asRecord(result['details']) !== undefined
  );
}

/**
 * Narrows an unknown to a plain object without asserting its contents.
 *
 * One predicate rather than the three spellings this file used to hold: a
 * boolean `isPlainObject`, and two inline `typeof … !== 'object' || … === null`
 * guards that let arrays through and relied on the following property lookup to
 * reject them.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Recognises an `http-errors`-shaped rejection raised *before* routing — the
 * body parser's `PayloadTooLargeError` (413) being the one this application
 * actually produces, when a request body exceeds `BODY_LIMIT`.
 *
 * These are not `HttpException`s, so without this they fell through to the
 * "unhandled defect" arm and came back as **500 with a logged stack** — a wrong
 * status class for a client input error, and a log-flood vector for an
 * unauthenticated caller. (Nest converts `SyntaxError`-with-`body` and
 * `URIError` into `BadRequestException` itself, which is why malformed JSON
 * already answered 400 correctly and oversized bodies did not.)
 *
 * `expose` is `http-errors`' own signal for "this message is safe to show the
 * client" — it sets it `true` for 4xx and `false` for 5xx. Keying on it rather
 * than on the status alone means a third-party 4xx that marks its message
 * internal is not forwarded either.
 */
export function asExposedClientError(exception: unknown): TransportErrorBody | undefined {
  const candidate = asRecord(exception);
  if (candidate === undefined) {
    return undefined;
  }
  const status = candidate['status'] ?? candidate['statusCode'];
  if (
    candidate['expose'] !== true ||
    typeof status !== 'number' ||
    status < HttpStatus.BAD_REQUEST ||
    status >= HttpStatus.INTERNAL_SERVER_ERROR ||
    typeof candidate['message'] !== 'string'
  ) {
    return undefined;
  }
  return { statusCode: status, message: candidate['message'] };
}
