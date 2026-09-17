/**
 * The two admin user procedures. Both are `@Roles('ADMIN')`.
 *
 * See `spots.controller.ts` for the shape; the interesting part is the router
 * built in the constructor.
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
import { UsersService } from './users.service';

@Controller(RPC_ROUTE_PREFIX)
export class UsersController {
  private readonly rpc: RpcRouteHandler;

  constructor(users: UsersService, @InjectPinoLogger(UsersController.name) logger: PinoLogger) {
    this.rpc = new RpcRouteHandler(
      {
        admin: {
          user: {
            list: implementer.admin.user.list.handler(async ({ input }) => ({
              users: await users.adminList(input),
            })),
            update: implementer.admin.user.update.handler(({ input, context }) =>
              users.adminUpdate(input, context.user)
            ),
          },
        },
      },
      logger
    );
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'user', 'list'))
  adminListUsers(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'user', 'update'))
  adminUpdateUser(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }
}
