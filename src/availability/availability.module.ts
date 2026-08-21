import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import {
  AvailabilityController,
  PublicAvailabilityController,
} from './availability.controller';
import { AvailabilityService } from './availability.service';

@Module({
  imports: [AccountsModule],
  controllers: [AvailabilityController, PublicAvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
