/**
 * `reservation.create`, `reservation.cancel` and `reservation.myMonth`, each on
 * its own Nest route, plus the admin-only `admin.reservation.month`.
 *
 * The three `reservation.*` routes carry no `@Roles()`: any authenticated user
 * may reserve, and any authenticated user may cancel — *their own*. "Their own"
 * is an authorization rule about a row, not about a route, so it lives in
 * `ReservationsService` where the row is, and the admin exemption lives there
 * with it.
 *
 * `admin.reservation.month` is the exception, and it is `@Roles('ADMIN')`:
 * reading somebody else's month is a rule about the *route*, because there is
 * no row-level decision to make once the subject is a parameter. It sits here
 * rather than on a controller of its own so that it stays next to the service
 * method it shares a body with (`ReservationsService.monthSummary`).
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
import { Roles } from '../auth/roles.decorator';
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
        admin: {
          reservation: {
            month: implementer.admin.reservation.month.handler(({ input, context }) =>
              reservations.userMonth(input, context.user)
            ),
          },
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

  @Roles('ADMIN')
  @Post(rpcRoute('admin', 'reservation', 'month'))
  adminUserMonthReservations(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }
}
