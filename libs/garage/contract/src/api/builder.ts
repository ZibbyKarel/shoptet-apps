/**
 * The tools every procedure in this contract is defined with.
 *
 * Deliberately **not** re-exported from `@garage/contract` (see
 * `api/index.ts`): a procedure defined outside `libs/garage/contract` is the one
 * thing the contract-first rule exists to make impossible, and an exported
 * builder is an invitation to try. The ten procedure modules in this
 * directory import from here; nothing else may.
 */

import { oc } from '@orpc/contract';
import * as z from 'zod';
import type { ErrorCode } from '../schemas/errors';
import { ERROR_DEFINITIONS } from './errors';

/**
 * Picks the error definitions a procedure declares.
 *
 * ```ts
 * authed.errors(contractErrors('NOT_FOUND', 'SPOT_ALREADY_RESERVED'))
 * ```
 *
 * The return type is a `Pick`, so the client sees exactly the codes a procedure
 * can produce — declaring one and throwing another is a type error on the
 * backend, and a code that is not in `ERROR_CODES` does not compile at all.
 */
export function contractErrors<const TCodes extends readonly ErrorCode[]>(
  ...codes: TCodes
): Pick<typeof ERROR_DEFINITIONS, TCodes[number]> {
  return Object.fromEntries(codes.map((code) => [code, ERROR_DEFINITIONS[code]])) as Pick<
    typeof ERROR_DEFINITIONS,
    TCodes[number]
  >;
}

/**
 * Base builder every procedure in this contract starts from.
 *
 * `FORBIDDEN` is declared once here rather than repeated thirty times: it is
 * reachable on **every** procedure, because a deactivated user (`active: false`,
 * how offboarding works) is rejected before any handler runs. Procedures that
 * are additionally admin-only do not need to redeclare it.
 */
export const authed = oc.errors(contractErrors('FORBIDDEN'));

/**
 * Input schema for procedures that take no arguments.
 *
 * oRPC allows `.input()` to be omitted entirely, but an omitted schema means an
 * accidental payload is silently ignored, and it leaves the procedure without
 * the input schema this contract requires of every procedure. Declaring the
 * absence of input is stricter than not declaring input.
 *
 * It accepts `undefined` **and** `{}` on purpose. The RPC transport delivers
 * `undefined` for an argument-less call, while oRPC's OpenAPI input mapping
 * merges path/query/body into an object and hands a parameter-less GET an empty
 * one. `z.void()` would pass the first and reject the second, which would turn
 * the handler choice in Task 12 into a runtime break here. Anything with a key
 * in it is still rejected.
 */
export const noInputSchema = z.strictObject({}).optional();

/** `undefined` — the only value a caller of a no-input procedure should send. */
export type NoInput = z.infer<typeof noInputSchema>;
