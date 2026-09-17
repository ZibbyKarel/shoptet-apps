import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReservationWindowController } from './reservation-window.controller';
import { ReservationWindowService } from './reservation-window.service';

/**
 * `ReservationWindowService` is exported because the day overview embeds the
 * window state of the day it is asked about, and Task 13 enforces the window
 * before writing a reservation. All three must read it the same way.
 */
@Module({
  imports: [AuditModule],
  controllers: [ReservationWindowController],
  providers: [ReservationWindowService],
  exports: [ReservationWindowService],
})
export class ReservationWindowModule {}
