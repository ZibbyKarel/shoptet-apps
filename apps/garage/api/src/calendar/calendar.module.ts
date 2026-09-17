import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

/**
 * The personal ICS feed. No `AuditModule`: reading a calendar is a read, and
 * an append-only table that grows once per poll per subscriber would bury the
 * changes it exists to record.
 */
@Module({
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
