/**
 * The five spot procedures, each on its own Nest route.
 *
 * The route is where authorization lives — `@Roles('ADMIN')` on the four
 * `admin.spot.*` procedures, nothing on `spot.list`, which any authenticated
 * user needs for the preferred-spot picker. See `rpc-route-handler.ts` for why
 * the transport is mounted per procedure rather than once behind a catch-all.
 *
 * Every method body is the same delegation. The interesting part is the router
 * built in the constructor: those handlers are what oRPC validates the input and
 * output of against `libs/garage/contract`.
 */

import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX, rpcRoute } from '../orpc/rpc-route';
import { SpotsService } from './spots.service';

@Controller(RPC_ROUTE_PREFIX)
export class SpotsController {
  private readonly rpc: RpcRouteHandler;

  constructor(spots: SpotsService, @InjectPinoLogger(SpotsController.name) logger: PinoLogger) {
    this.rpc = new RpcRouteHandler(
      {
        spot: {
          list: implementer.spot.list.handler(async () => ({ spots: await spots.listActive() })),
        },
        admin: {
          spot: {
            list: implementer.admin.spot.list.handler(async ({ input }) => ({
              spots: await spots.adminList(input),
            })),
            create: implementer.admin.spot.create.handler(({ input, context }) =>
              spots.create(input, context.user.id)
            ),
            update: implementer.admin.spot.update.handler(({ input, context }) =>
              spots.update(input, context.user.id)
            ),
            deactivate: implementer.admin.spot.deactivate.handler(({ input, context }) =>
              spots.deactivate(input, context.user.id)
            ),
          },
        },
      },
      logger
    );
  }

  /** Active spots. Any authenticated user. */
  @Post(rpcRoute('spot', 'list'))
  listSpots(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'spot', 'list'))
  adminListSpots(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'spot', 'create'))
  createSpot(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'spot', 'update'))
  updateSpot(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'spot', 'deactivate'))
  deactivateSpot(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }
}
