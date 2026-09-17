import { Global, Module } from '@nestjs/common';
import { GracefulShutdownService } from './graceful-shutdown.service';

/**
 * Global so that Task 15's gateway module can inject
 * `GracefulShutdownService` without importing anything — there must be exactly
 * one registry, or a closer registered against a second instance is never run.
 */
@Global()
@Module({
  providers: [GracefulShutdownService],
  exports: [GracefulShutdownService],
})
export class ShutdownModule {}
