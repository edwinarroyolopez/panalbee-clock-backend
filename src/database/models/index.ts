import { ModelDefinition } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import {
  AppointmentEntity,
  AppointmentIntervalLockEntity,
  AppointmentIntervalLockSchema,
  AppointmentSchema,
  NotificationEntity,
  NotificationSchema,
} from './booking.models';
import {
  AvailabilityExceptionEntity,
  AvailabilityExceptionSchema,
  CustomerEntity,
  CustomerSchema,
  LocationEntity,
  LocationSchema,
  ScheduleEntity,
  ScheduleSchema,
  ServiceEntity,
  ServiceSchema,
  StaffEntity,
  StaffSchema,
  StaffServiceEntity,
  StaffServiceSchema,
  TenantEntity,
  TenantMembershipEntity,
  TenantMembershipSchema,
  TenantSchema,
} from './core.models';
import {
  AuditEventEntity,
  AuditEventSchema,
  ChannelEntity,
  ChannelSchema,
  ConversationEntity,
  ConversationSchema,
  ConversationStateHistoryEntity,
  ConversationStateHistorySchema,
  MessageEntity,
  MessageSchema,
  ProviderEventEntity,
  ProviderEventSchema,
} from './communication.models';
import { MODEL_NAMES } from './model-names';
import { UuidEntity } from './schema-helpers';
import { UserEntity, UserSchema } from './user.model';

export * from './booking.models';
export * from './communication.models';
export * from './core.models';
export * from './model-names';
export * from './schema-helpers';
export * from './user.model';

export const CLOCK_MODEL_DEFINITIONS: ModelDefinition[] = [
  { name: MODEL_NAMES.Tenant, schema: TenantSchema },
  { name: MODEL_NAMES.Location, schema: LocationSchema },
  { name: MODEL_NAMES.User, schema: UserSchema },
  { name: MODEL_NAMES.TenantMembership, schema: TenantMembershipSchema },
  { name: MODEL_NAMES.Customer, schema: CustomerSchema },
  { name: MODEL_NAMES.Service, schema: ServiceSchema },
  { name: MODEL_NAMES.Staff, schema: StaffSchema },
  { name: MODEL_NAMES.StaffService, schema: StaffServiceSchema },
  { name: MODEL_NAMES.Schedule, schema: ScheduleSchema },
  {
    name: MODEL_NAMES.AvailabilityException,
    schema: AvailabilityExceptionSchema,
  },
  { name: MODEL_NAMES.Appointment, schema: AppointmentSchema },
  {
    name: MODEL_NAMES.AppointmentIntervalLock,
    schema: AppointmentIntervalLockSchema,
  },
  { name: MODEL_NAMES.Channel, schema: ChannelSchema },
  { name: MODEL_NAMES.Conversation, schema: ConversationSchema },
  {
    name: MODEL_NAMES.ConversationStateHistory,
    schema: ConversationStateHistorySchema,
  },
  { name: MODEL_NAMES.Message, schema: MessageSchema },
  { name: MODEL_NAMES.ProviderEvent, schema: ProviderEventSchema },
  { name: MODEL_NAMES.Notification, schema: NotificationSchema },
  { name: MODEL_NAMES.AuditEvent, schema: AuditEventSchema },
];

export interface ClockModels {
  tenant: Model<TenantEntity>;
  location: Model<LocationEntity>;
  user: Model<UserEntity>;
  tenantMembership: Model<TenantMembershipEntity>;
  customer: Model<CustomerEntity>;
  service: Model<ServiceEntity>;
  staff: Model<StaffEntity>;
  staffService: Model<StaffServiceEntity>;
  schedule: Model<ScheduleEntity>;
  availabilityException: Model<AvailabilityExceptionEntity>;
  appointment: Model<AppointmentEntity>;
  appointmentIntervalLock: Model<AppointmentIntervalLockEntity>;
  channel: Model<ChannelEntity>;
  conversation: Model<ConversationEntity>;
  conversationStateHistory: Model<ConversationStateHistoryEntity>;
  message: Model<MessageEntity>;
  providerEvent: Model<ProviderEventEntity>;
  notification: Model<NotificationEntity>;
  auditEvent: Model<AuditEventEntity>;
}

function registeredModel<T>(connection: Connection, name: string): Model<T> {
  return connection.model<T>(name);
}

export function clockModels(connection: Connection): ClockModels {
  return {
    tenant: registeredModel(connection, MODEL_NAMES.Tenant),
    location: registeredModel(connection, MODEL_NAMES.Location),
    user: registeredModel(connection, MODEL_NAMES.User),
    tenantMembership: registeredModel(connection, MODEL_NAMES.TenantMembership),
    customer: registeredModel(connection, MODEL_NAMES.Customer),
    service: registeredModel(connection, MODEL_NAMES.Service),
    staff: registeredModel(connection, MODEL_NAMES.Staff),
    staffService: registeredModel(connection, MODEL_NAMES.StaffService),
    schedule: registeredModel(connection, MODEL_NAMES.Schedule),
    availabilityException: registeredModel(
      connection,
      MODEL_NAMES.AvailabilityException,
    ),
    appointment: registeredModel(connection, MODEL_NAMES.Appointment),
    appointmentIntervalLock: registeredModel(
      connection,
      MODEL_NAMES.AppointmentIntervalLock,
    ),
    channel: registeredModel(connection, MODEL_NAMES.Channel),
    conversation: registeredModel(connection, MODEL_NAMES.Conversation),
    conversationStateHistory: registeredModel(
      connection,
      MODEL_NAMES.ConversationStateHistory,
    ),
    message: registeredModel(connection, MODEL_NAMES.Message),
    providerEvent: registeredModel(connection, MODEL_NAMES.ProviderEvent),
    notification: registeredModel(connection, MODEL_NAMES.Notification),
    auditEvent: registeredModel(connection, MODEL_NAMES.AuditEvent),
  };
}

export async function syncClockIndexes(connection: Connection): Promise<void> {
  for (const { name } of CLOCK_MODEL_DEFINITIONS) {
    const model = connection.model<UuidEntity>(name);
    await model.syncIndexes();
  }
}
