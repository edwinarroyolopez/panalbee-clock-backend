import { Schema } from 'mongoose';
import { INDEX_NAMES } from './model-names';
import {
  createdAtOptions,
  optionalUuidField,
  requiredUuidField,
  UuidEntity,
  uuidField,
} from './schema-helpers';

export interface AppointmentSurveyResponseEntity extends UuidEntity {
  tenantId: string;
  appointmentId: string;
  customerId: string;
  rating: number;
  comment?: string | null;
  evidenceId?: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  createdAt: Date;
}

export const APPOINTMENT_SURVEY_APPEND_ONLY_ERROR =
  'appointment survey responses are append-only';
export const AppointmentSurveyResponseSchema: Schema<AppointmentSurveyResponseEntity> =
  new Schema<AppointmentSurveyResponseEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      appointmentId: requiredUuidField(),
      customerId: requiredUuidField(),
      rating: { type: Number, required: true, min: 1, max: 5 },
      comment: { type: String, maxlength: 2000 },
      evidenceId: optionalUuidField(),
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
    createdAtOptions<AppointmentSurveyResponseEntity>(
      'appointment_survey_responses',
    ),
  );
AppointmentSurveyResponseSchema.index(
  { tenantId: 1, appointmentId: 1 },
  { unique: true, name: INDEX_NAMES.appointmentSurveyAppointment },
);
AppointmentSurveyResponseSchema.index(
  { tenantId: 1, appointmentId: 1, idempotencyKey: 1 },
  { unique: true, name: INDEX_NAMES.appointmentSurveyIdempotency },
);
AppointmentSurveyResponseSchema.pre('save', function () {
  if (!this.isNew) throw new Error(APPOINTMENT_SURVEY_APPEND_ONLY_ERROR);
});
AppointmentSurveyResponseSchema.pre(
  /^(?:update|replace|delete|findOneAnd)/,
  function () {
    throw new Error(APPOINTMENT_SURVEY_APPEND_ONLY_ERROR);
  },
);
AppointmentSurveyResponseSchema.pre('bulkWrite', function () {
  throw new Error(APPOINTMENT_SURVEY_APPEND_ONLY_ERROR);
});
