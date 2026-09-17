/**
 * The caller's own profile and settings. No `@Roles()` — every authenticated
 * user reaches their own record and nobody else's, which the service enforces by
 * taking the subject from `context.user` rather than from the payload.
 */

import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX, rpcRoute } from '../orpc/rpc-route';
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

  @Post(rpcRoute('me', 'get'))
  getProfile(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Post(rpcRoute('me', 'updateSettings'))
  updateSettings(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }

  @Post(rpcRoute('me', 'regenerateIcsToken'))
  regenerateIcsToken(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    return this.rpc.handle(request, response, user);
  }
}
