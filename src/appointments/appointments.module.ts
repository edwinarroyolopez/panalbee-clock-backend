import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AvailabilityModule } from '../availability/availability.module';
import { ChannelsModule } from '../channels/channels.module';
import { CONVERSATION_COMMAND_HANDLER } from '../conversations/conversation-command.port';
import { AppointmentCreationStore } from './appointment-creation.store';
import { AppointmentEffectsService } from './appointment-effects.service';
import { AppointmentIntervalLockService } from './appointment-interval-lock.service';
import { AppointmentManagementAccessService } from './appointment-management-access.service';
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
import {
  PublicCustomerAccessController,
  PublicCustomerAppointmentsController,
} from './customer-appointments.controller';
import { CustomerAppointmentAccessService } from './customer-appointment-access.service';
import { CustomerAccessDeliveryService } from './customer-access-delivery.service';

@Module({
  imports: [AccountsModule, AvailabilityModule, ChannelsModule],
  controllers: [
    AppointmentsController,
    PublicAppointmentsController,
    PublicCustomerAccessController,
    PublicCustomerAppointmentsController,
  ],
  providers: [
    AppointmentsService,
    AppointmentManagementService,
    AppointmentCreationStore,
    AppointmentEffectsService,
    AppointmentIntervalLockService,
    AppointmentManagementAccessService,
    AppointmentPublicQueryService,
    AppointmentRescheduleRelationService,
    CustomerAppointmentAccessService,
    CustomerAccessDeliveryService,
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
