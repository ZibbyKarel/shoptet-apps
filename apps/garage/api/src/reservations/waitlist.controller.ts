/**
 * `waitlist.join` and `waitlist.leave`.
 *
 * A separate controller from `ReservationsController` rather than four routes on
 * one, because the two services are separate and a controller in this codebase
 * is a thin delegation to exactly one of them. There is no `waitlist.promote`
 * and there never will be: promotion is not something a client can ask for.
 */

import { Controller } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX } from '../orpc/rpc-route';
import { RpcRoute } from '../orpc/rpc-route.decorator';
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

  @RpcRoute('waitlist', 'join')
  joinWaitlist(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('waitlist', 'leave')
  leaveWaitlist(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }
}
