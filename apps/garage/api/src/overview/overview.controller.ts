/**
 * The day overview. One procedure, available to every authenticated user — the
 * parking screen is what everybody opens the application for.
 */

import { Controller } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX } from '../orpc/rpc-route';
import { RpcRoute } from '../orpc/rpc-route.decorator';
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

  @RpcRoute('overview', 'day')
  getDay(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }
}
