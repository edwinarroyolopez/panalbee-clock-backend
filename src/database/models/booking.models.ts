import { Schema } from 'mongoose';
import { INDEX_NAMES } from './model-names';
import {
  createdAtOptions,
  documentOptions,
  optionalUuidField,
  requiredUuidField,
  TimestampedEntity,
  UuidEntity,
  uuidField,
  validateOrderedInterval,
} from './schema-helpers';

export type AppointmentStatus =
  'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

export type AppointmentSource = 'ADMIN' | 'WEB' | 'WHATSAPP' | 'OTHER';

export interface AppointmentEntity extends TimestampedEntity {
  tenantId: string;
  locationId: string;
  serviceId: string;
  staffId: string;
  customerId: string;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  sourceChannel: AppointmentSource;
  idempotencyKey: string;
  requestFingerprint: string;
  managementTokenHash?: string | null;
  notes?: string | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
}

export interface AppointmentIntervalLockEntity extends UuidEntity {
  tenantId: string;
  staffId: string;
  appointmentId: string;
  intervalStart: Date;
  createdAt: Date;
}

export interface CustomerAccessChallengeEntity extends TimestampedEntity {
  tenantId: string;
  phoneHash: string;
  requestBucket: number;
  requesterHash: string;
  customerId?: string | null;
  codeHash: string;
  codeExpiresAt: Date;
  expiresAt: Date;
  attempts: number;
  consumedAt?: Date | null;
  sessionTokenHash?: string | null;
}

export type NotificationType =
  | 'BOOKING_CONFIRMATION'
  | 'BOOKING_REMINDER'
  | 'BOOKING_RESCHEDULED'
  | 'BOOKING_CANCELLED';

export type NotificationStatus =
  'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface NotificationEntity extends TimestampedEntity {
  tenantId: string;
  appointmentId: string;
  customerId: string;
  channelId?: string | null;
  type: NotificationType;
  scheduledFor: Date;
  status: NotificationStatus;
  attempts: number;
  idempotencyKey: string;
  lastErrorCode?: string | null;
  leaseUntil?: Date | null;
}

export const AppointmentSchema: Schema<AppointmentEntity> =
  new Schema<AppointmentEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      locationId: requiredUuidField(),
      serviceId: requiredUuidField(),
      staffId: requiredUuidField(),
      customerId: requiredUuidField(),
      status: {
        type: String,
        enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
        default: 'CONFIRMED',
      },
      startsAt: { type: Date, required: true },
      endsAt: { type: Date, required: true },
      sourceChannel: {
        type: String,
        enum: ['ADMIN', 'WEB', 'WHATSAPP', 'OTHER'],
        default: 'ADMIN',
      },
      idempotencyKey: { type: String, required: true },
      requestFingerprint: { type: String, required: true },
      managementTokenHash: { type: String },
      notes: { type: String },
      cancelledAt: { type: Date },
      cancellationReason: { type: String },
    },
    documentOptions<AppointmentEntity>('appointments'),
  );
AppointmentSchema.pre('validate', validateOrderedInterval);
AppointmentSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, name: INDEX_NAMES.appointmentIdempotency },
);
AppointmentSchema.index(
  { tenantId: 1, locationId: 1, startsAt: 1, status: 1 },
  { name: INDEX_NAMES.appointmentAgenda },
);
AppointmentSchema.index(
  { tenantId: 1, customerId: 1, startsAt: -1 },
  { name: INDEX_NAMES.appointmentCustomer },
);

export const AppointmentIntervalLockSchema: Schema<AppointmentIntervalLockEntity> =
  new Schema<AppointmentIntervalLockEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      staffId: requiredUuidField(),
      appointmentId: requiredUuidField(),
      intervalStart: { type: Date, required: true },
    },
    createdAtOptions<AppointmentIntervalLockEntity>(
      'appointment_interval_locks',
    ),
  );
AppointmentIntervalLockSchema.index(
  { tenantId: 1, staffId: 1, intervalStart: 1 },
  { unique: true, name: INDEX_NAMES.appointmentIntervalLock },
);
AppointmentIntervalLockSchema.index(
  { tenantId: 1, appointmentId: 1 },
  { name: INDEX_NAMES.appointmentLockOwner },
);

export const CustomerAccessChallengeSchema: Schema<CustomerAccessChallengeEntity> =
  new Schema<CustomerAccessChallengeEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      phoneHash: {
        type: String,
        required: true,
        match: /^[0-9a-f]{64}$/,
      },
      requestBucket: { type: Number, required: true, min: 0 },
      requesterHash: {
        type: String,
        required: true,
        match: /^[0-9a-f]{64}$/,
      },
      customerId: optionalUuidField(),
      codeHash: {
        type: String,
        required: true,
        match: /^[0-9a-f]{64}$/,
      },
      codeExpiresAt: { type: Date, required: true },
      expiresAt: { type: Date, required: true },
      attempts: { type: Number, default: 0, min: 0, max: 5 },
      consumedAt: { type: Date },
      sessionTokenHash: {
        type: String,
        match: /^[0-9a-f]{64}$/,
      },
    },
    documentOptions<CustomerAccessChallengeEntity>(
      'customer_access_challenges',
    ),
  );
CustomerAccessChallengeSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: INDEX_NAMES.customerAccessExpiry },
);
CustomerAccessChallengeSchema.index(
  { tenantId: 1, phoneHash: 1, createdAt: -1 },
  { name: INDEX_NAMES.customerAccessPhone },
);
CustomerAccessChallengeSchema.index(
  { tenantId: 1, phoneHash: 1, requestBucket: 1 },
  { unique: true, name: INDEX_NAMES.customerAccessPhoneBucket },
);
CustomerAccessChallengeSchema.index(
  { tenantId: 1, requesterHash: 1, createdAt: -1 },
  { name: INDEX_NAMES.customerAccessRequester },
);
CustomerAccessChallengeSchema.index(
  { sessionTokenHash: 1 },
  {
    unique: true,
    name: INDEX_NAMES.customerAccessSessionToken,
    partialFilterExpression: { sessionTokenHash: { $type: 'string' } },
  },
);

export const NotificationSchema: Schema<NotificationEntity> =
  new Schema<NotificationEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      appointmentId: requiredUuidField(),
      customerId: requiredUuidField(),
      channelId: optionalUuidField(),
      type: {
        type: String,
        enum: [
          'BOOKING_CONFIRMATION',
          'BOOKING_REMINDER',
          'BOOKING_RESCHEDULED',
          'BOOKING_CANCELLED',
        ],
        required: true,
      },
      scheduledFor: { type: Date, required: true },
      status: {
        type: String,
        enum: ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'],
        default: 'PENDING',
      },
      attempts: { type: Number, default: 0, min: 0 },
      idempotencyKey: { type: String, required: true },
      lastErrorCode: { type: String },
      leaseUntil: { type: Date },
    },
    documentOptions<NotificationEntity>('notifications'),
  );
NotificationSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, name: INDEX_NAMES.notificationIdempotency },
);
NotificationSchema.index(
  { status: 1, scheduledFor: 1, leaseUntil: 1, _id: 1 },
  { name: INDEX_NAMES.notificationWorker },
);
