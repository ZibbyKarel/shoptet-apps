/**
 * Mapping a failure that came back over the wire onto the contract's closed
 * error enum.
 *
 * `libs/garage/contract` defines the domain errors (`ERROR_CODES`, `errorShapeSchema`,
 * `doc/decision/0016-*`, `0018-*`); oRPC carries them as `ORPCError`
 * (`{ code, status, message, data }`, where `data` is the contract's
 * `details` — `doc/decision/0018-*`). This module is the one place that turns
 * the second into the first, so that feature code can `switch` on a member of
 * `ERROR_CODES` and never touch an oRPC type.
 *
 * ## Why not `isDefinedError`
 *
 * oRPC ships `isDefinedError`, which narrows by the runtime `defined` flag.
 * That flag is **always `false`** for this backend: `apps/garage/api`'s global filter
 * serialises every domain failure with `defined: false`, because an error that
 * reached the filter is by definition one the procedure did not declare
 * (`doc/decision/0033-*`, `contractErrorBody()`). Narrowing on `defined` would
 * therefore reject every real domain error. The check here is on the **code**
 * instead — parsed against `errorCodeSchema`, so a value outside the closed
 * enum can never be presented as a contract error.
 *
 * Full reasoning, and a live server-side mismatch this module does not fix:
 * `doc/decision/0039-*`.
 */

import { ORPCError } from '@orpc/client';
import type { ErrorCode, ErrorDetails } from '@garage/contract';
import { errorCodeSchema, errorDetailsSchema } from '@garage/contract';

/**
 * A failure that carries a code from the contract's closed enum.
 *
 * Deliberately a plain object rather than the oRPC error itself: it is the
 * shape `libs/query` and every feature consumer read, and keeping oRPC's class
 * out of it is what lets those callers stay free of `@orpc/client`.
 *
 * `details` is always present as a key (`undefined` when the error carried
 * none) because `exactOptionalPropertyTypes` is on workspace-wide: an optional
 * property and a property that may be `undefined` are different types here, and
 * the always-present form is the one callers can destructure without a guard.
 */
export interface ContractError {
  code: ErrorCode;
  /** Developer-facing text. UI copy is keyed off `code` in `libs/shared/i18n`. */
  message: string;
  /** The HTTP status `ERROR_DEFINITIONS` assigns the code. */
  status: number;
  /** The contract's `details`, oRPC's `data`. `undefined` when absent. */
  details: ErrorDetails | undefined;
}

/**
 * The HTTP status behind a rejected call, or `undefined` when there wasn't one.
 *
 * `undefined` means the request never got a response — a dropped connection, a
 * DNS failure, an aborted fetch. That distinction is the whole input to the
 * retry policy in `libs/query`: a 4xx will fail again identically, whereas a
 * transport failure is exactly what a retry is for.
 *
 * Verified against a real `RPCLink`, not reasoned: an HTTP failure always
 * arrives as an `ORPCError` — with the declared code when the body is a proper
 * RPC payload, and with a status-derived one (`TOO_MANY_REQUESTS` for 429,
 * `INTERNAL_SERVER_ERROR` for 500) when it is not. A `fetch` rejection arrives
 * as the original `TypeError`. See `errors.spec.ts`.
 */
export function errorStatus(error: unknown): number | undefined {
  return error instanceof ORPCError ? error.status : undefined;
}

/**
 * Reads a contract error out of whatever the client threw, or `null` when the
 * failure is not one of the contract's domain errors.
 *
 * `null` covers three different things on purpose — a transport failure, a
 * response whose code is outside `ERROR_CODES`, and a plain JavaScript error —
 * because a caller can do nothing different about any of them: none of them has
 * localized copy keyed to a code, so all three are "something went wrong".
 */
export function toContractError(error: unknown): ContractError | null {
  if (!(error instanceof ORPCError)) {
    return null;
  }

  const code = errorCodeSchema.safeParse(error.code);
  if (!code.success) {
    return null;
  }

  const details = errorDetailsSchema.safeParse(error.data);

  return {
    code: code.data,
    message: error.message,
    status: error.status,
    details: details.success ? details.data : undefined,
  };
}
