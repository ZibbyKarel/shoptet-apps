/**
 * The day overview. One procedure, available to every authenticated user — the
 * parking screen is what everybody opens the application for.
 */

import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX, rpcRoute } from '../orpc/rpc-route';
import { DayOverviewService } from './day-overview.service';

@Controller(RPC_ROUTE_PREFIX)
export class OverviewController {
  private readonly rpc: RpcRouteHandler;

  constructor(
    overview: DayOverviewService,
    @InjectPinoLogger(OverviewController.name) logger: PinoLogger
  ) {
    this.rpc = new RpcRouteHandler(
      {
        overview: {
          day: implementer.overview.day.handler(({ input, context }) =>
            overview.getDay(input, context.user)
          ),
        },
      },
      logger
    );
  }

  @Post(rpcRoute('overview', 'day'))
  getDay(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }
}
