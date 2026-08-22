import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import { ManagementAccess } from './appointment-management-access.service';

@Injectable()
export class AppointmentFeedbackEffectsService {
  constructor(private readonly database: DatabaseService) {}

  async recordEvidence(
    access: ManagementAccess,
    evidenceId: string,
    idempotencyKey: string,
    requestFingerprint: string,
    session: ClientSession,
  ): Promise<void> {
    await this.database.models.appointmentTimelineEvent.create(
      [
        {
          tenantId: access.tenantId,
          appointmentId: access.appointmentId,
          actorType: access.actorType,
          ...(access.actorUserId ? { actorUserId: access.actorUserId } : {}),
          eventType: 'EVIDENCE_ADDED',
          evidenceId,
          idempotencyKey: `evidence:${idempotencyKey}`,
          requestFingerprint,
        },
      ],
      { session },
    );
    await this.database.models.auditEvent.create(
      [
        {
          tenantId: access.tenantId,
          ...(access.actorUserId ? { actorUserId: access.actorUserId } : {}),
          actorType: access.actorType,
          action: 'APPOINTMENT_EVIDENCE_ADDED',
          entityType: 'appointment',
          entityId: access.appointmentId,
          metadata: {},
        },
      ],
      { session },
    );
  }

  async recordSurvey(
    access: ManagementAccess,
    surveyId: string,
    rating: number,
    evidenceId: string | undefined,
    idempotencyKey: string,
    requestFingerprint: string,
    session: ClientSession,
  ): Promise<void> {
    await this.database.models.appointmentTimelineEvent.create(
      [
        {
          tenantId: access.tenantId,
          appointmentId: access.appointmentId,
          actorType: 'CUSTOMER',
          eventType: 'SURVEY_SUBMITTED',
          surveyRating: rating,
          ...(evidenceId ? { evidenceId } : {}),
          idempotencyKey: `survey:${idempotencyKey}`,
          requestFingerprint,
        },
      ],
      { session },
    );
    await this.database.models.auditEvent.create(
      [
        {
          tenantId: access.tenantId,
          actorType: 'CUSTOMER',
          action: 'APPOINTMENT_SURVEY_SUBMITTED',
          entityType: 'appointment',
          entityId: access.appointmentId,
          metadata: { surveyId },
        },
      ],
      { session },
    );
  }
}
