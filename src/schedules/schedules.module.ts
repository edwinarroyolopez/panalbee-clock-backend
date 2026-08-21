import { Module } from '@nestjs/common';
import {
  AvailabilityExceptionsController,
  SchedulesController,
} from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  controllers: [SchedulesController, AvailabilityExceptionsController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
