/**
 * The caller's own profile and settings. No `@Roles()` — every authenticated
 * user reaches their own record and nobody else's, which the service enforces by
 * taking the subject from `context.user` rather than from the payload.
 */

import { Controller } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX } from '../orpc/rpc-route';
import { RpcRoute } from '../orpc/rpc-route.decorator';
import { MeService } from './me.service';

@Controller(RPC_ROUTE_PREFIX)
export class MeController {
  private readonly rpc: RpcRouteHandler;

  constructor(me: MeService, @InjectPinoLogger(MeController.name) logger: PinoLogger) {
    this.rpc = new RpcRouteHandler(
      {
        me: {
          get: implementer.me.get.handler(({ context }) => me.getProfile(context.user.id)),
          updateSettings: implementer.me.updateSettings.handler(({ input, context }) =>
            me.updateSettings(input, context.user.id)
          ),
          regenerateIcsToken: implementer.me.regenerateIcsToken.handler(async ({ context }) => ({
            icsToken: await me.regenerateIcsToken(context.user.id),
          })),
        },
      },
      logger
    );
  }

  @RpcRoute('me', 'get')
  getProfile(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('me', 'updateSettings')
  updateSettings(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('me', 'regenerateIcsToken')
  regenerateIcsToken(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }
}
