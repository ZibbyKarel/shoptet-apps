/**
 * `waitlist.join` and `waitlist.leave`.
 *
 * A separate controller from `ReservationsController` rather than four routes on
 * one, because the two services are separate and a controller in this codebase
 * is a thin delegation to exactly one of them. There is no `waitlist.promote`
 * and there never will be: promotion is not something a client can ask for.
 */

import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX, rpcRoute } from '../orpc/rpc-route';
import { WaitlistService } from './waitlist.service';

@Controller(RPC_ROUTE_PREFIX)
export class WaitlistController {
  private readonly rpc: RpcRouteHandler;

  constructor(
    waitlist: WaitlistService,
    @InjectPinoLogger(WaitlistController.name) logger: PinoLogger
  ) {
    this.rpc = new RpcRouteHandler(
      {
        waitlist: {
          join: implementer.waitlist.join.handler(({ input, context }) =>
            waitlist.join(input, context.user)
          ),
          leave: implementer.waitlist.leave.handler(({ input, context }) =>
            waitlist.leave(input, context.user)
          ),
        },
      },
      logger
    );
  }

  @Post(rpcRoute('waitlist', 'join'))
  joinWaitlist(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Post(rpcRoute('waitlist', 'leave'))
  leaveWaitlist(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }
}
