/**
 * The bridge between one Nest route and one oRPC procedure.
 *
 * ## Why a route per procedure rather than one catch-all
 *
 * oRPC's own `RPCHandler` is perfectly capable of routing `/api/rpc/**` on its
 * own, and mounting it once behind a single `@All()` would be less code. It
 * would also put every procedure behind one set of guards, which is the thing
 * this application cannot afford: `admin.*` is admin-only, and the mechanism
 * for that in this codebase is `@Roles('ADMIN')` on the route (Task 11,
 * `doc/auth.md` §"Adding an authenticated route"). A catch-all would have forced
 * a second, oRPC-side authorization mechanism next to the guard that already
 * exists — two places to get "who may do this" right.
 *
 * So each procedure gets a Nest route whose only body is a delegation to here.
 * The route carries the decorators; oRPC carries the protocol. A procedure with
 * no route is unreachable (404), which is the safe direction, and
 * `orpc-route-parity.spec.ts` fails when the two lists drift.
 *
 * ## Why the request and response objects are handed over raw
 *
 * `RPCHandler` writes the response itself — status, headers and the `{ json,
 * meta }` envelope the RPC protocol defines. That is precisely what makes the
 * codes readable on the client (`doc/decision/0039-*`), so nothing here may
 * reshape it. The Nest route is therefore in library-specific mode (`@Res()`),
 * and returns nothing.
 *
 * Nest's body parser has already consumed the stream by this point;
 * `@orpc/standard-server-node` checks `req.body` before reading, so the parsed
 * body is what the codec decodes. `orpc-pipeline.spec.ts` drives real HTTP
 * through the assembled app rather than trusting that.
 */

import { NotFoundException } from '@nestjs/common';
import { onError } from '@orpc/server';
import type { RPCHandlerOptions } from '@orpc/server/node';
import { RPCHandler } from '@orpc/server/node';
import type { Request, Response } from 'express';
import type { PinoLogger } from 'nestjs-pino';
import { ORPCError } from '@orpc/server';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { OrpcContext } from './orpc-context';
import { RPC_PATH_PREFIX } from './rpc-route';

/**
 * An implemented (sub-)router, as `RPCHandler` accepts it.
 *
 * Read off the constructor rather than written as `Router<any, OrpcContext>`,
 * which is what oRPC declares: spelling it out would put an `any` in this app's
 * own source, and it would silently stop matching if oRPC ever narrowed the
 * parameter.
 */
export type OrpcRouter = ConstructorParameters<typeof RPCHandler<OrpcContext>>[0];

/**
 * Wraps one implemented (sub-)router in an `RPCHandler` and the logging every
 * other layer of this app already has.
 */
export class RpcRouteHandler {
  private readonly handler: RPCHandler<OrpcContext>;

  /**
   * The router this handler dispatches into, kept for
   * `orpc-route-parity.spec.ts`.
   *
   * `RPCHandler` dispatches on the **URL path**, so which procedure a request
   * runs is decided by the key it sits under in this object — not by the name of
   * the controller method that delegated here, which is decorative. Moving an
   * implementation to a neighbouring key would therefore serve the wrong
   * procedure at a path the parity spec still considers correctly mounted.
   * Exposing the router lets that spec compare each leaf's schemas against the
   * contract procedure for its own path, which is the only thing that
   * distinguishes two sibling implementations from each other.
   */
  readonly router: OrpcRouter;

  constructor(router: OrpcRouter, logger: PinoLogger) {
    this.router = router;
    const options: RPCHandlerOptions<OrpcContext> = {
      interceptors: [
        onError((error) => {
          if (error instanceof ORPCError) {
            // A declared outcome, not a defect: the code is the message. `warn`
            // for the same reason the exception filter uses it — logging these
            // at `error` would drown the ones that are defects.
            logger.warn({ errorCode: error.code, status: error.status }, 'Procedure rejected');
            return;
          }
          logger.error({ err: error }, 'Unhandled error inside an oRPC procedure');
        }),
      ],
    };
    this.handler = new RPCHandler(router, options);
  }

  /**
   * Runs the procedure the request URL names.
   *
   * `matched: false` means the URL is under `/api/rpc` but names no procedure in
   * *this* router. That is a 404 rather than a silent empty response: without
   * the throw, Nest would hold the request open forever, because `@Res()` has
   * told it not to send anything.
   */
  async handle(request: Request, response: Response, user: AuthenticatedUser): Promise<void> {
    const { matched } = await this.handler.handle(request, response, {
      prefix: RPC_PATH_PREFIX,
      context: { user },
    });

    if (!matched) {
      throw new NotFoundException();
    }
  }
}
