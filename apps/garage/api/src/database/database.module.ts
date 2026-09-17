import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global so that every feature module gets the *same* `PrismaService` — and so
 * that the one connection pool this single-instance deployment owns cannot be
 * duplicated by a module that forgets to import this one.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
