import { Schema } from 'mongoose';
import { INDEX_NAMES } from './model-names';
import {
  createdAtOptions,
  optionalUuidField,
  requiredUuidField,
  UuidEntity,
  uuidField,
} from './schema-helpers';

export type AppointmentEvidenceScope = 'SERVICE' | 'SURVEY';

export interface AppointmentEvidenceEntity extends UuidEntity {
  tenantId: string;
  appointmentId: string;
  customerId: string;
  scope: AppointmentEvidenceScope;
  actorType: 'TENANT_USER' | 'INTERNAL_USER' | 'CUSTOMER';
  actorUserId?: string | null;
  storageKey: string;
  format: 'jpg' | 'jpeg' | 'png' | 'webp';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  width: number;
  height: number;
  originalFileName: string;
  idempotencyKey: string;
  requestFingerprint: string;
  createdAt: Date;
}

export const APPOINTMENT_EVIDENCE_APPEND_ONLY_ERROR =
  'appointment evidence is append-only';
export const AppointmentEvidenceSchema: Schema<AppointmentEvidenceEntity> =
  new Schema<AppointmentEvidenceEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      appointmentId: requiredUuidField(),
      customerId: requiredUuidField(),
      scope: { type: String, enum: ['SERVICE', 'SURVEY'], required: true },
      actorType: {
        type: String,
        enum: ['TENANT_USER', 'INTERNAL_USER', 'CUSTOMER'],
        required: true,
      },
      actorUserId: optionalUuidField(),
      storageKey: {
        type: String,
        required: true,
        minlength: 1,
        maxlength: 500,
      },
      format: {
        type: String,
        enum: ['jpg', 'jpeg', 'png', 'webp'],
        required: true,
      },
      mimeType: {
        type: String,
        enum: ['image/jpeg', 'image/png', 'image/webp'],
        required: true,
      },
      sizeBytes: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
      width: { type: Number, required: true, min: 1 },
      height: { type: Number, required: true, min: 1 },
      originalFileName: {
        type: String,
        required: true,
        minlength: 1,
        maxlength: 255,
      },
      idempotencyKey: {
        type: String,
        required: true,
        minlength: 8,
        maxlength: 128,
      },
      requestFingerprint: {
        type: String,
        required: true,
        match: /^[0-9a-f]{64}$/,
      },
    },
    createdAtOptions<AppointmentEvidenceEntity>('appointment_evidence'),
  );
AppointmentEvidenceSchema.index(
  { tenantId: 1, appointmentId: 1, createdAt: 1, _id: 1 },
  { name: INDEX_NAMES.appointmentEvidenceOrdering },
);
AppointmentEvidenceSchema.index(
  { tenantId: 1, appointmentId: 1, idempotencyKey: 1 },
  { unique: true, name: INDEX_NAMES.appointmentEvidenceIdempotency },
);
AppointmentEvidenceSchema.pre('save', function () {
  if (!this.isNew) throw new Error(APPOINTMENT_EVIDENCE_APPEND_ONLY_ERROR);
});
AppointmentEvidenceSchema.pre(
  /^(?:update|replace|delete|findOneAnd)/,
  function () {
    throw new Error(APPOINTMENT_EVIDENCE_APPEND_ONLY_ERROR);
  },
);
AppointmentEvidenceSchema.pre('bulkWrite', function () {
  throw new Error(APPOINTMENT_EVIDENCE_APPEND_ONLY_ERROR);
});
