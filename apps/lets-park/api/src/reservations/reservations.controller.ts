/**
 * `reservation.create` and `reservation.cancel`, each on its own Nest route.
 *
 * No `@Roles()` on either: any authenticated user may reserve, and any
 * authenticated user may cancel — *their own*. "Their own" is an authorization
 * rule about a row, not about a route, so it lives in `ReservationsService`
 * where the row is, and the admin exemption lives there with it.
 *
 * `reservation.previewBulk` / `reservation.confirmBulk` are not here either, but
 * they are no longer absent: Task 30 put them on `BulkReservationController`,
 * next to the service that owns them.
 */

import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX, rpcRoute } from '../orpc/rpc-route';
import { ReservationsService } from './reservations.service';

@Controller(RPC_ROUTE_PREFIX)
export class ReservationsController {
  private readonly rpc: RpcRouteHandler;

  constructor(
    reservations: ReservationsService,
    @InjectPinoLogger(ReservationsController.name) logger: PinoLogger
  ) {
    this.rpc = new RpcRouteHandler(
      {
        reservation: {
          create: implementer.reservation.create.handler(({ input, context }) =>
            reservations.create(input, context.user)
          ),
          cancel: implementer.reservation.cancel.handler(({ input, context }) =>
            reservations.cancel(input, context.user)
          ),
          myMonth: implementer.reservation.myMonth.handler(({ input, context }) =>
            reservations.myMonth(input, context.user)
          ),
        },
      },
      logger
    );
  }

  @Post(rpcRoute('reservation', 'create'))
  createReservation(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Post(rpcRoute('reservation', 'cancel'))
  cancelReservation(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Post(rpcRoute('reservation', 'myMonth'))
  myMonthReservations(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }
}
