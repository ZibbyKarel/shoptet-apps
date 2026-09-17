import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SpotsController } from './spots.controller';
import { SpotsService } from './spots.service';

/**
 * `SpotsService` is exported because the day overview reads the same active-spot
 * listing, and having two definitions of "which spots exist" is how the grid and
 * the picker start disagreeing.
 */
@Module({
  imports: [AuditModule],
  controllers: [SpotsController],
  providers: [SpotsService],
  exports: [SpotsService],
})
export class SpotsModule {}
