/**
 * `reservation.previewBulk` and `reservation.confirmBulk`.
 *
 * A separate controller from `ReservationsController` for the same reason
 * `WaitlistController` is one: a controller here is a thin delegation to exactly
 * one service, and bulk booking has its own.
 *
 * No `@Roles()`: any authenticated user may book for themselves. The batch may
 * now name a different holder (`input.holderId`) — `BulkReservationService`
 * authorizes that with `ReservationPolicy.assertMayNameWaitlistTarget`, the
 * same rule `WaitlistService.join` applies, so a route-level admin-only guard
 * would wrongly lock out the common case of a normal user booking for
 * themselves.
 */

import { Controller } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX } from '../orpc/rpc-route';
import { RpcRoute } from '../orpc/rpc-route.decorator';
import { BulkReservationService } from './bulk-reservation.service';

@Controller(RPC_ROUTE_PREFIX)
export class BulkReservationController {
  private readonly rpc: RpcRouteHandler;

  constructor(
    bulk: BulkReservationService,
    @InjectPinoLogger(BulkReservationController.name) logger: PinoLogger
  ) {
    this.rpc = new RpcRouteHandler(
      {
        reservation: {
          previewBulk: implementer.reservation.previewBulk.handler(({ input, context }) =>
            bulk.preview(input, context.user)
          ),
          confirmBulk: implementer.reservation.confirmBulk.handler(({ input, context }) =>
            bulk.confirm(input, context.user)
          ),
        },
      },
      logger
    );
  }

  @RpcRoute('reservation', 'previewBulk')
  previewBulk(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('reservation', 'confirmBulk')
  confirmBulk(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }
}
