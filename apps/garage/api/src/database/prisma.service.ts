/**
 * The application's single `PrismaClient`, with a Nest lifecycle attached.
 *
 * The client is built by `createPrismaClient` from `@garage/database`, which
 * that lib documents as the one place the Prisma 7 driver adapter is wired up.
 * This service **composes** the client rather than extending `PrismaClient`:
 * subclassing would mean calling `super()` with a locally rebuilt adapter,
 * duplicating exactly the setup `createPrismaClient` exists to centralise. The
 * cost is one extra word at every call site (`prisma.client.reservation…`).
 *
 * What this class adds is lifetime:
 *
 * - `onModuleInit` connects eagerly, so an unreachable database fails at boot
 *   rather than on the first request that happens to touch it.
 * - `onModuleDestroy` closes the `pg` pool. Nest calls it during graceful
 *   shutdown, after in-flight requests have finished, which is the ordering
 *   that keeps Postgres from being left with half-open connections.
 */

import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { PrismaClient } from '@garage/database';
import { createPrismaClient } from '@garage/database';
import type { ApiEnv } from '../env';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /** The Prisma client. Repositories and services query through this. */
  readonly client: PrismaClient;

  constructor(
    configService: ConfigService<ApiEnv, true>,
    @InjectPinoLogger(PrismaService.name) private readonly logger: PinoLogger
  ) {
    this.client = createPrismaClient({
      connectionString: configService.get('DATABASE_URL', { infer: true }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.info('Database pool connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
    this.logger.info('Database pool closed');
  }

  /**
   * The readiness probe's query.
   *
   * `SELECT 1` is the cheapest statement that still proves the whole path
   * works: a connection was available in the pool, the server answered, and the
   * session is usable. Anything cheaper — checking that the client object
   * exists, or that `$connect()` once resolved — would pass while Postgres is
   * down, which is precisely the failure a readiness probe exists to catch.
   */
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }
}
