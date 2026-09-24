/**
 * The two admin user procedures. Both are `@Roles('ADMIN')`.
 *
 * See `spots.controller.ts` for the shape; the interesting part is the router
 * built in the constructor.
 */

import { Controller } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Roles } from '../auth/roles.decorator';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX } from '../orpc/rpc-route';
import { RpcRoute } from '../orpc/rpc-route.decorator';
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
  @RpcRoute('admin', 'user', 'list')
  adminListUsers(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'user', 'update')
  adminUpdateUser(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }
}
