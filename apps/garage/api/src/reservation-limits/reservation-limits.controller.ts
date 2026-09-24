/**
 * The two reservation-limit procedures. Both admin-only: an ordinary user meets
 * the cap as the `cap` field on their month summary, not as a settings read.
 */

import { Controller } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Roles } from '../auth/roles.decorator';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX } from '../orpc/rpc-route';
import { RpcRoute } from '../orpc/rpc-route.decorator';
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
  @RpcRoute('admin', 'reservationLimits', 'get')
  getSettings(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'reservationLimits', 'update')
  updateSettings(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }
}
