/**
 * The three reservation-window procedures. All admin-only: an ordinary user gets
 * the state of the day they are looking at from `overview.day` instead.
 */

import { Controller } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Roles } from '../auth/roles.decorator';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX } from '../orpc/rpc-route';
import { RpcRoute } from '../orpc/rpc-route.decorator';
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
  @RpcRoute('admin', 'window', 'get')
  getSettings(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'window', 'update')
  updateSettings(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'window', 'months')
  listMonths(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }
}
