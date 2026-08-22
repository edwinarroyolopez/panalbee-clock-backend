import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AvailabilityModule } from '../availability/availability.module';
import { ChannelsModule } from '../channels/channels.module';
import { CONVERSATION_COMMAND_HANDLER } from '../conversations/conversation-command.port';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppointmentCreationStore } from './appointment-creation.store';
import { AppointmentEffectsService } from './appointment-effects.service';
import { AppointmentIntervalLockService } from './appointment-interval-lock.service';
import { AppointmentLifecycleService } from './appointment-lifecycle.service';
import { AppointmentTimelineService } from './appointment-timeline.service';
import { AppointmentEvidenceService } from './appointment-evidence.service';
import { AppointmentEvidenceStorageService } from './appointment-evidence-storage.service';
import { AppointmentSurveyService } from './appointment-survey.service';
import { AppointmentFeedbackEffectsService } from './appointment-feedback-effects.service';
import {
  PublicAppointmentFeedbackController,
  PublicCustomerAppointmentFeedbackController,
  TenantAppointmentFeedbackController,
} from './appointment-feedback.controller';
import { AppointmentLifecycleNotificationService } from './appointment-lifecycle-notification.service';
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
  imports: [
    AccountsModule,
    AvailabilityModule,
    ChannelsModule,
    NotificationsModule,
  ],
  controllers: [
    AppointmentsController,
    PublicAppointmentsController,
    PublicCustomerAccessController,
    PublicCustomerAppointmentsController,
    TenantAppointmentFeedbackController,
    PublicAppointmentFeedbackController,
    PublicCustomerAppointmentFeedbackController,
  ],
  providers: [
    AppointmentsService,
    AppointmentManagementService,
    AppointmentCreationStore,
    AppointmentEffectsService,
    AppointmentIntervalLockService,
    AppointmentLifecycleService,
    AppointmentTimelineService,
    AppointmentEvidenceService,
    AppointmentEvidenceStorageService,
    AppointmentSurveyService,
    AppointmentFeedbackEffectsService,
    AppointmentLifecycleNotificationService,
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
