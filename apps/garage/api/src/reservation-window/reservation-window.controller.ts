/**
 * The three reservation-window procedures. All admin-only: an ordinary user gets
 * the state of the day they are looking at from `overview.day` instead.
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
import { ReservationWindowService } from './reservation-window.service';

@Controller(RPC_ROUTE_PREFIX)
export class ReservationWindowController {
  private readonly rpc: RpcRouteHandler;

  constructor(
    window: ReservationWindowService,
    @InjectPinoLogger(ReservationWindowController.name) logger: PinoLogger
  ) {
    this.rpc = new RpcRouteHandler(
      {
        admin: {
          window: {
            get: implementer.admin.window.get.handler(() => window.getSettings()),
            update: implementer.admin.window.update.handler(({ input, context }) =>
              window.updateSettings(input, context.user.id)
            ),
            months: implementer.admin.window.months.handler(({ input }) =>
              window.listMonths(input)
            ),
          },
        },
      },
      logger
    );
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'window', 'get'))
  getSettings(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'window', 'update'))
  updateSettings(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'window', 'months'))
  listMonths(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }
}
