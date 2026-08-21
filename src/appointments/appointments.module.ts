import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AvailabilityModule } from '../availability/availability.module';
import { CONVERSATION_COMMAND_HANDLER } from '../conversations/conversation-command.port';
import { AppointmentCreationStore } from './appointment-creation.store';
import { AppointmentEffectsService } from './appointment-effects.service';
import { AppointmentIntervalLockService } from './appointment-interval-lock.service';
import { AppointmentManagementService } from './appointment-management.service';
import { AppointmentPublicQueryService } from './appointment-public-query.service';
import { AppointmentRescheduleRelationService } from './appointment-reschedule-relation.service';
import {
  AppointmentsController,
  PublicAppointmentsController,
} from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { ConversationBookingHandler } from './conversation-booking.handler';
import { ConversationBookingRelationService } from './conversation-booking-relation.service';

@Module({
  imports: [AccountsModule, AvailabilityModule],
  controllers: [AppointmentsController, PublicAppointmentsController],
  providers: [
    AppointmentsService,
    AppointmentManagementService,
    AppointmentCreationStore,
    AppointmentEffectsService,
    AppointmentIntervalLockService,
    AppointmentPublicQueryService,
    AppointmentRescheduleRelationService,
    ConversationBookingHandler,
    ConversationBookingRelationService,
    {
      provide: CONVERSATION_COMMAND_HANDLER,
      useExisting: ConversationBookingHandler,
    },
  ],
  exports: [
    AppointmentsService,
    AppointmentManagementService,
    CONVERSATION_COMMAND_HANDLER,
  ],
})
export class AppointmentsModule {}
