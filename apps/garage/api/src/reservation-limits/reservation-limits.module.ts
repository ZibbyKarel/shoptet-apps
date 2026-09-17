import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReservationLimitsController } from './reservation-limits.controller';
import { ReservationLimitsService } from './reservation-limits.service';

/**
 * `ReservationLimitsService` is exported because the month summary reports the
 * cap in force alongside the count, so `ReservationsService` reads it too — and
 * it must read it the same way the admin screen writes it.
 *
 * The enforcement path does **not** go through here: it calls
 * `readMonthlyReservationCap` inside its own transaction. See that function.
 */
@Module({
  imports: [AuditModule],
  controllers: [ReservationLimitsController],
  providers: [ReservationLimitsService],
  exports: [ReservationLimitsService],
})
export class ReservationLimitsModule {}
