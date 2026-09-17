/**
 * The safety net that keeps a domain failure from becoming a 500.
 *
 * `ContractExceptionFilter` cannot do this job for an oRPC procedure: oRPC
 * catches whatever a handler throws inside `StandardHandler.handle`, runs it
 * through `toORPCError` and writes the response itself, so the exception never
 * reaches a Nest filter. Anything that is not already an `ORPCError` therefore
 * arrives at the client as `INTERNAL_SERVER_ERROR` — including a
 * `DomainError('FORBIDDEN')` and a P2002 that is really `SPOT_ALREADY_RESERVED`.
 *
 * So the translation the filter does for the rest of the app is repeated here,
 * once, as a middleware on the implementer (`implementer.ts`) — reusing the
 * filter's own `mapPrismaErrorCode` rather than a second copy of the constraint
 * table.
 *
 * Handlers still raise their **declared** failures through oRPC's typed
 * `errors.NOT_FOUND(...)`, which is what the contract's error map is for. This
 * is the net under that, not a replacement for it: a code the procedure did not
 * declare arrives with `defined: false`, which the client reads by code anyway
 * (`doc/decision/0039-*`).
 */

import { ORPCError } from '@orpc/server';
import type { ErrorCode } from '@garage/contract';
import { ERROR_DEFINITIONS } from '@garage/contract';
import { Prisma } from '@garage/database';
import { DomainError } from '../common/errors/domain-error';
import { mapPrismaErrorCode } from '../common/errors/prisma-error-mapping';

/** Builds the oRPC error for a contract code, with the status the contract assigns it. */
export function orpcErrorFor(
  code: ErrorCode,
  options: { message?: string; data?: unknown; cause?: unknown } = {}
): ORPCError<ErrorCode, unknown> {
  const definition = ERROR_DEFINITIONS[code];
  return new ORPCError(code, {
    status: definition.status,
    message: options.message ?? definition.message,
    ...(options.data === undefined ? {} : { data: options.data }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
}

/**
 * Translates a thrown value into the oRPC error it means, or returns `null`
 * when it means nothing in particular.
 *
 * `null` is the honest answer for a defect: the closed `ERROR_CODES` enum has no
 * member for "the server broke", and inventing one would let a bug arrive at the
 * frontend dressed as a domain outcome it has Czech copy for. The caller rethrows
 * the original, oRPC answers 500, and the stack goes to the log.
 */
export function toOrpcError(error: unknown): ORPCError<ErrorCode, unknown> | null {
  if (error instanceof DomainError) {
    return orpcErrorFor(error.code, {
      message: error.message,
      ...(error.details === undefined ? {} : { data: error.details }),
      cause: error,
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const code = mapPrismaErrorCode(error);
    if (code === undefined) {
      return null;
    }
    // `error.meta` is deliberately not forwarded as `data`: it names constraints
    // and columns, which is server internals. Same rule as the filter's.
    return orpcErrorFor(code, { cause: error });
  }

  return null;
}
