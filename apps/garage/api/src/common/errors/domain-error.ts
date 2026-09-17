/**
 * The exception the service layer throws when a domain rule is violated.
 *
 * It carries nothing but a contract `ErrorCode` and optional `details`: the
 * HTTP status and the developer-facing default message both come from
 * `ERROR_DEFINITIONS` in `libs/garage/contract`, so a status can never drift from the
 * contract by being re-typed at a throw site.
 *
 * This is deliberately *not* an `HttpException`. Nest's exception classes bake
 * a status and a body shape into the throw, which is exactly the ad-hoc error
 * shape global constraint 3 forbids. `ContractExceptionFilter` is the single
 * place that turns a code into a response.
 *
 * Procedures reached through oRPC (Tasks 12–13) normally throw oRPC's own typed
 * `errors.SPOT_ALREADY_RESERVED(...)`, which oRPC serializes itself. This class
 * is for code that runs outside an oRPC handler, and for services that would
 * otherwise have to depend on the oRPC error map to signal a domain failure.
 */

import type { ErrorCode, ErrorDetails } from '@garage/contract';
import { ERROR_DEFINITIONS } from '@garage/contract';

export class DomainError extends Error {
  readonly code: ErrorCode;
  /**
   * `| undefined` rather than `?`: `exactOptionalPropertyTypes` is on, and this
   * is genuinely "present but empty", not "absent". The filter is what decides
   * whether the field appears on the wire.
   */
  readonly details: ErrorDetails | undefined;

  constructor(code: ErrorCode, options: { message?: string; details?: ErrorDetails } = {}) {
    super(options.message ?? ERROR_DEFINITIONS[code].message);
    this.name = 'DomainError';
    this.code = code;
    this.details = options.details;
  }

  /** The HTTP status the contract assigns to this code. Never re-typed locally. */
  get status(): number {
    return ERROR_DEFINITIONS[this.code].status;
  }
}
