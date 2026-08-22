import {
  AppointmentEvidenceEntity,
  AppointmentSurveyResponseEntity,
} from '../database/models';

export interface AppointmentEvidenceView {
  id: string;
  scope: AppointmentEvidenceEntity['scope'];
  fileName: string;
  mimeType: AppointmentEvidenceEntity['mimeType'];
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  url: string;
  expiresAt: string;
}

export interface AppointmentSurveyView {
  id: string;
  rating: number;
  comment: string | null;
  evidenceId: string | null;
  createdAt: string;
}

export function appointmentEvidenceView(
  evidence: AppointmentEvidenceEntity,
  access: { url: string; expiresAt: string },
): AppointmentEvidenceView {
  return {
    id: evidence._id,
    scope: evidence.scope,
    fileName: evidence.originalFileName,
    mimeType: evidence.mimeType,
    sizeBytes: evidence.sizeBytes,
    width: evidence.width,
    height: evidence.height,
    createdAt: evidence.createdAt.toISOString(),
    ...access,
  };
}

export function appointmentSurveyView(
  survey: AppointmentSurveyResponseEntity,
): AppointmentSurveyView {
  return {
    id: survey._id,
    rating: survey.rating,
    comment: survey.comment ?? null,
    evidenceId: survey.evidenceId ?? null,
    createdAt: survey.createdAt.toISOString(),
  };
}
