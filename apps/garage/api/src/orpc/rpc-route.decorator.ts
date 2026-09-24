/**
 * Collapses one RPC route to a single declaration.
 *
 * Every procedure in this application gets its own Nest route
 * (`rpc-route-handler.ts` explains why), and every one of those routes has the
 * exact same body: pull `@Req()`, `@Res()` and `@CurrentUser()`, hand them to
 * `this.rpc.handle(...)`. Only the path (and sometimes `@Roles()`) differs. This
 * decorator is that repeated shape, written once.
 *
 * ```ts
 * @Roles('ADMIN')
 * @RpcRoute('admin', 'spot', 'list')
 * adminListSpots(): Promise<void> {
 *   return undefined as never; // replaced below — see the decorator
 * }
 * ```
 *
 * **The written method body never runs.** The decorator replaces
 * `descriptor.value` with the real delegation before attaching `@Post()`'s
 * route metadata, so the metadata (which `orpc-route-parity.spec.ts` reads
 * straight off the prototype) lands on the function that actually handles the
 * request, not on the placeholder above it. The placeholder exists only so the
 * method type-checks as `(): Promise<void>` without a caller ever reaching its
 * body; `throw` (rather than a value) makes that "never actually runs" honest
 * to the compiler too. `@Req()`/`@Res()`/`@CurrentUser()` are applied the same
 * way `@Roles()` is applied above this decorator: called directly as the
 * parameter-decorator functions they are, rather than written out on a
 * signature nothing executes.
 */

import { Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RpcRouteHandler } from './rpc-route-handler';
import { rpcRoute } from './rpc-route';

/** A controller with the one field every RPC controller builds in its constructor. */
interface HasRpcRouteHandler {
  readonly rpc: RpcRouteHandler;
}

export function RpcRoute(...segments: readonly string[]): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    descriptor.value = function (
      this: HasRpcRouteHandler,
      request: Request,
      response: Response,
      user: AuthenticatedUser
    ): Promise<void> {
      return this.rpc.handle(request, response, user);
    };

    Post(rpcRoute(...segments))(target, propertyKey, descriptor);
    Req()(target, propertyKey, 0);
    Res()(target, propertyKey, 1);
    CurrentUser()(target, propertyKey, 2);

    return descriptor;
  };
}
