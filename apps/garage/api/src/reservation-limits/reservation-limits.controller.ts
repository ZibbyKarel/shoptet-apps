/**
 * The two reservation-limit procedures. Both admin-only: an ordinary user meets
 * the cap as the `cap` field on their month summary, not as a settings read.
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
import { ReservationLimitsService } from './reservation-limits.service';

@Controller(RPC_ROUTE_PREFIX)
export class ReservationLimitsController {
  private readonly rpc: RpcRouteHandler;

  constructor(
    limits: ReservationLimitsService,
    @InjectPinoLogger(ReservationLimitsController.name) logger: PinoLogger
  ) {
    this.rpc = new RpcRouteHandler(
      {
        admin: {
          reservationLimits: {
            get: implementer.admin.reservationLimits.get.handler(() => limits.getSettings()),
            update: implementer.admin.reservationLimits.update.handler(({ input, context }) =>
              limits.updateSettings(input, context.user.id)
            ),
          },
        },
      },
      logger
    );
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'reservationLimits', 'get'))
  getSettings(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'reservationLimits', 'update'))
  updateSettings(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }
}
