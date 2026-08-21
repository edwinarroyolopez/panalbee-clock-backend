import { Module } from '@nestjs/common';
import {
  AvailabilityController,
  PublicAvailabilityController,
} from './availability.controller';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [AvailabilityController, PublicAvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
