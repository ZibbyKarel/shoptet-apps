/**
 * The one implementer every procedure in this app is built from.
 *
 * `implement(contract)` binds the handlers to the Zod schemas in
 * `libs/garage/contract`: input and output are validated against the contract on every
 * call, and a handler whose return value does not satisfy the output schema does
 * not compile. That is what makes "no endpoint may exist before it exists in the
 * contract" enforceable rather than aspirational — there is no way to add a
 * procedure here that the contract does not already declare.
 *
 * One middleware is attached at the root, so it wraps every procedure including
 * its validation: {@link toOrpcError}, the translation from a thrown
 * `DomainError` or Prisma constraint violation into the contract error it means.
 * See that file for why a Nest exception filter cannot do it.
 */

import { implement } from '@orpc/server';
import { contract } from '@garage/contract';
import type { OrpcContext } from './orpc-context';
import { toOrpcError } from './to-orpc-error';

export const implementer = implement(contract)
  .$context<OrpcContext>()
  .use(async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      const mapped = toOrpcError(error);
      if (mapped === null) {
        // Not a domain failure. Rethrow the original so oRPC answers 500 and the
        // handler's `onError` interceptor logs the real stack.
        throw error;
      }
      throw mapped;
    }
  });
