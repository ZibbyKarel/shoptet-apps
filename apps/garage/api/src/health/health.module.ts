import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health-indicator';
import { HealthController } from './health.controller';

@Module({
  imports: [
    TerminusModule.forRoot({
      // The health endpoints are for orchestrators, not humans: a stack trace
      // in a probe response is a stack trace on any network that can reach the
      // probe. Terminus logs the cause itself.
      errorLogStyle: 'json',
    }),
  ],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator],
})
export class HealthModule {}
