import { Schema } from 'mongoose';
import type { AppointmentStatus } from './booking.models';
import { INDEX_NAMES } from './model-names';
import {
  createdAtOptions,
  optionalUuidField,
  requiredUuidField,
  UuidEntity,
  uuidField,
} from './schema-helpers';

export const APPOINTMENT_TIMELINE_EVENT_TYPES = [
  'CREATED',
  'RESCHEDULED',
  'CANCELLED',
  'STARTED',
  'COMPLETED',
  'NO_SHOW',
  'EVIDENCE_ADDED',
  'SURVEY_SUBMITTED',
] as const;
export type AppointmentTimelineEventType =
  (typeof APPOINTMENT_TIMELINE_EVENT_TYPES)[number];

export interface AppointmentTimelineEventEntity extends UuidEntity {
  tenantId: string;
  appointmentId: string;
  eventType: AppointmentTimelineEventType;
  actorType:
    'TENANT_USER' | 'INTERNAL_USER' | 'CUSTOMER' | 'SYSTEM' | 'CHANNEL';
  actorUserId?: string | null;
  fromStatus?: AppointmentStatus | null;
  toStatus?: AppointmentStatus | null;
  reasonCode?: string | null;
  note?: string | null;
  previousStartsAt?: Date | null;
  previousEndsAt?: Date | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  evidenceId?: string | null;
  surveyRating?: number | null;
  idempotencyKey: string;
  requestFingerprint: string;
  createdAt: Date;
}

export const APPOINTMENT_TIMELINE_APPEND_ONLY_ERROR =
  'appointment timeline events are append-only';
export const AppointmentTimelineEventSchema: Schema<AppointmentTimelineEventEntity> =
  new Schema<AppointmentTimelineEventEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      appointmentId: requiredUuidField(),
      eventType: {
        type: String,
        enum: APPOINTMENT_TIMELINE_EVENT_TYPES,
        required: true,
      },
      actorType: {
        type: String,
        enum: ['TENANT_USER', 'INTERNAL_USER', 'CUSTOMER', 'SYSTEM', 'CHANNEL'],
        required: true,
      },
      actorUserId: optionalUuidField(),
      fromStatus: {
        type: String,
        enum: [
          'PENDING',
          'CONFIRMED',
          'IN_PROGRESS',
          'CANCELLED',
          'COMPLETED',
          'NO_SHOW',
        ],
      },
      toStatus: {
        type: String,
        enum: [
          'PENDING',
          'CONFIRMED',
          'IN_PROGRESS',
          'CANCELLED',
          'COMPLETED',
          'NO_SHOW',
        ],
      },
      reasonCode: { type: String, maxlength: 100 },
      note: { type: String, maxlength: 2000 },
      previousStartsAt: { type: Date },
      previousEndsAt: { type: Date },
      startsAt: { type: Date },
      endsAt: { type: Date },
      evidenceId: optionalUuidField(),
      surveyRating: { type: Number, min: 1, max: 5 },
      idempotencyKey: {
        type: String,
        required: true,
        minlength: 8,
        maxlength: 160,
      },
      requestFingerprint: {
        type: String,
        required: true,
        match: /^[0-9a-f]{64}$/,
      },
    },
    createdAtOptions<AppointmentTimelineEventEntity>(
      'appointment_timeline_events',
    ),
  );
AppointmentTimelineEventSchema.index(
  { tenantId: 1, appointmentId: 1, createdAt: 1, _id: 1 },
  { name: INDEX_NAMES.appointmentTimelineOrdering },
);
AppointmentTimelineEventSchema.index(
  { tenantId: 1, appointmentId: 1, idempotencyKey: 1 },
  { unique: true, name: INDEX_NAMES.appointmentTimelineIdempotency },
);
AppointmentTimelineEventSchema.pre('save', function () {
  if (!this.isNew) throw new Error(APPOINTMENT_TIMELINE_APPEND_ONLY_ERROR);
});
AppointmentTimelineEventSchema.pre(
  /^(?:update|replace|delete|findOneAnd)/,
  function () {
    throw new Error(APPOINTMENT_TIMELINE_APPEND_ONLY_ERROR);
  },
);
AppointmentTimelineEventSchema.pre('bulkWrite', function () {
  throw new Error(APPOINTMENT_TIMELINE_APPEND_ONLY_ERROR);
});
AppointmentTimelineEventSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function () {
    throw new Error(APPOINTMENT_TIMELINE_APPEND_ONLY_ERROR);
  },
);
AppointmentTimelineEventSchema.pre(
  'updateOne',
  { document: true, query: false },
  function () {
    throw new Error(APPOINTMENT_TIMELINE_APPEND_ONLY_ERROR);
  },
);
