import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  AppointmentSurveyResponseEntity,
  INDEX_NAMES,
  isNamedDuplicateKey,
} from '../database/models';
import {
  AppointmentManagementAccessService,
  ManagementAccess,
} from './appointment-management-access.service';
import {
  PublicSubmitAppointmentSurveyDto,
  SubmitAppointmentSurveyDto,
} from './appointment.dto';
import {
  AppointmentSurveyView,
  appointmentSurveyView,
} from './appointment-feedback.view';
import { AppointmentTimelineService } from './appointment-timeline.service';
import { AppointmentTimelineView } from './appointment.view';
import { AppointmentFeedbackEffectsService } from './appointment-feedback-effects.service';

@Injectable()
export class AppointmentSurveyService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accesses: AppointmentManagementAccessService,
    private readonly timelines: AppointmentTimelineService,
    private readonly effects: AppointmentFeedbackEffectsService,
  ) {}

  async timelineCustomer(
    tenantId: string,
    customerId: string,
    appointmentId: string,
  ): Promise<AppointmentTimelineView> {
    const access = this.accesses.customer(tenantId, customerId, appointmentId);
    await this.accesses.load(access);
    return this.timelines.get(tenantId, appointmentId, false);
  }

  async timelinePublic(
    tenantSlug: string,
    appointmentId: string,
    managementToken: string,
  ): Promise<AppointmentTimelineView> {
    const access = await this.accesses.public(
      tenantSlug,
      appointmentId,
      managementToken,
    );
    await this.accesses.load(access);
    return this.timelines.get(access.tenantId, appointmentId, false);
  }

  submitCustomer(
    tenantId: string,
    customerId: string,
    appointmentId: string,
    dto: SubmitAppointmentSurveyDto,
  ): Promise<AppointmentSurveyView> {
    return this.submit(
      this.accesses.customer(tenantId, customerId, appointmentId),
      dto,
    );
  }

  async submitPublic(
    tenantSlug: string,
    appointmentId: string,
    dto: PublicSubmitAppointmentSurveyDto,
  ): Promise<AppointmentSurveyView> {
    return this.submit(
      await this.accesses.public(
        tenantSlug,
        appointmentId,
        dto.managementToken,
      ),
      dto,
    );
  }

  private async submit(
    access: ManagementAccess,
    dto: SubmitAppointmentSurveyDto,
  ): Promise<AppointmentSurveyView> {
    const comment = dto.comment?.trim() || null;
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          rating: dto.rating,
          comment,
          evidenceId: dto.evidenceId ?? null,
        }),
      )
      .digest('hex');
    try {
      const survey = await this.database.withTransaction(async (session) => {
        const appointment = await this.accesses.load(access, session);
        if (appointment.status !== 'COMPLETED') {
          throw new AppException(
            409,
            'APPOINTMENT_SURVEY_STATUS_INVALID',
            'Only completed appointments accept a satisfaction response',
          );
        }
        const existing = await this.find(access, session);
        if (existing) {
          return this.assertReplay(
            existing,
            dto.idempotencyKey,
            requestFingerprint,
          );
        }
        if (dto.evidenceId) {
          const evidence = await this.database.models.appointmentEvidence
            .findOne({
              _id: dto.evidenceId,
              tenantId: access.tenantId,
              appointmentId: access.appointmentId,
              customerId: appointment.customerId,
              scope: 'SURVEY',
              actorType: 'CUSTOMER',
            })
            .session(session)
            .lean()
            .exec();
          if (!evidence) {
            throw new AppException(
              400,
              'APPOINTMENT_SURVEY_EVIDENCE_INVALID',
              'Survey evidence is invalid',
            );
          }
        }
        const [created] =
          await this.database.models.appointmentSurveyResponse.create(
            [
              {
                tenantId: access.tenantId,
                appointmentId: access.appointmentId,
                customerId: appointment.customerId,
                rating: dto.rating,
                ...(comment ? { comment } : {}),
                ...(dto.evidenceId ? { evidenceId: dto.evidenceId } : {}),
                idempotencyKey: dto.idempotencyKey,
                requestFingerprint,
              },
            ],
            { session },
          );
        await this.effects.recordSurvey(
          access,
          created._id,
          dto.rating,
          dto.evidenceId,
          dto.idempotencyKey,
          requestFingerprint,
          session,
        );
        return created.toObject();
      });
      return appointmentSurveyView(survey);
    } catch (error) {
      if (
        isNamedDuplicateKey(error, INDEX_NAMES.appointmentSurveyAppointment)
      ) {
        const existing = await this.find(access);
        if (existing) {
          return appointmentSurveyView(
            this.assertReplay(existing, dto.idempotencyKey, requestFingerprint),
          );
        }
      }
      throw error;
    }
  }

  private async find(
    access: ManagementAccess,
    session?: ClientSession,
  ): Promise<AppointmentSurveyResponseEntity | null> {
    return this.database.models.appointmentSurveyResponse
      .findOne({
        tenantId: access.tenantId,
        appointmentId: access.appointmentId,
      })
      .session(session ?? null)
      .lean()
      .exec();
  }

  private assertReplay(
    survey: AppointmentSurveyResponseEntity,
    idempotencyKey: string,
    requestFingerprint: string,
  ): AppointmentSurveyResponseEntity {
    if (
      survey.idempotencyKey === idempotencyKey &&
      survey.requestFingerprint === requestFingerprint
    ) {
      return survey;
    }
    if (survey.idempotencyKey === idempotencyKey) {
      throw new AppException(
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'Idempotency key was already used with different input',
      );
    }
    throw new AppException(
      409,
      'APPOINTMENT_SURVEY_ALREADY_SUBMITTED',
      'A satisfaction response was already submitted',
    );
  }
}
