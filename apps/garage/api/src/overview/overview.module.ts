import { Module } from '@nestjs/common';
import { ReservationWindowModule } from '../reservation-window/reservation-window.module';
import { SpotsModule } from '../spots/spots.module';
import { DayOverviewService } from './day-overview.service';
import { OverviewController } from './overview.controller';

/**
 * The overview composes rather than duplicates: the spot listing comes from
 * `SpotsModule` and the window state from `ReservationWindowModule`, so the grid
 * cannot disagree with the admin table or with the banner.
 */
@Module({
  imports: [SpotsModule, ReservationWindowModule],
  controllers: [OverviewController],
  providers: [DayOverviewService],
})
export class OverviewModule {}
