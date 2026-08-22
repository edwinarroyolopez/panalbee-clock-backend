import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  AppointmentEntity,
  AppointmentEvidenceEntity,
  AppointmentEvidenceScope,
  INDEX_NAMES,
  isNamedDuplicateKey,
} from '../database/models';
import {
  ManagementAccess,
  AppointmentManagementAccessService,
} from './appointment-management-access.service';
import { UploadAppointmentEvidenceDto } from './appointment.dto';
import {
  assertAppointmentEvidenceFile,
  safeEvidenceFileName,
} from './appointment-evidence-file.policy';
import { AppointmentEvidenceStorageService } from './appointment-evidence-storage.service';
import {
  AppointmentEvidenceView,
  appointmentEvidenceView,
} from './appointment-feedback.view';
import { AppointmentFeedbackEffectsService } from './appointment-feedback-effects.service';

interface EvidenceActor {
  actorType: 'TENANT_USER' | 'INTERNAL_USER' | 'CUSTOMER';
  actorUserId: string | null;
}

@Injectable()
export class AppointmentEvidenceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accesses: AppointmentManagementAccessService,
    private readonly storage: AppointmentEvidenceStorageService,
    private readonly effects: AppointmentFeedbackEffectsService,
  ) {}

  uploadTenant(
    tenantId: string,
    appointmentId: string,
    actor: EvidenceActor,
    dto: UploadAppointmentEvidenceDto,
    file?: Express.Multer.File,
  ): Promise<AppointmentEvidenceView> {
    return this.upload(
      {
        tenantId,
        appointmentId,
        actorUserId: actor.actorUserId,
        actorType: actor.actorType,
        publicOnly: false,
      },
      'SERVICE',
      dto,
      file,
    );
  }

  uploadCustomer(
    tenantId: string,
    customerId: string,
    appointmentId: string,
    dto: UploadAppointmentEvidenceDto,
    file?: Express.Multer.File,
  ): Promise<AppointmentEvidenceView> {
    return this.upload(
      this.accesses.customer(tenantId, customerId, appointmentId),
      'SURVEY',
      dto,
      file,
    );
  }

  async uploadPublic(
    tenantSlug: string,
    appointmentId: string,
    managementToken: string,
    dto: UploadAppointmentEvidenceDto,
    file?: Express.Multer.File,
  ): Promise<AppointmentEvidenceView> {
    return this.upload(
      await this.accesses.public(tenantSlug, appointmentId, managementToken),
      'SURVEY',
      dto,
      file,
    );
  }

  accessTenant(
    tenantId: string,
    appointmentId: string,
    evidenceId: string,
  ): Promise<AppointmentEvidenceView> {
    return this.access(
      {
        tenantId,
        appointmentId,
        actorType: 'TENANT_USER',
        actorUserId: null,
        publicOnly: false,
      },
      evidenceId,
    );
  }

  accessCustomer(
    tenantId: string,
    customerId: string,
    appointmentId: string,
    evidenceId: string,
  ): Promise<AppointmentEvidenceView> {
    return this.access(
      this.accesses.customer(tenantId, customerId, appointmentId),
      evidenceId,
    );
  }

  async accessPublic(
    tenantSlug: string,
    appointmentId: string,
    managementToken: string,
    evidenceId: string,
  ): Promise<AppointmentEvidenceView> {
    return this.access(
      await this.accesses.public(tenantSlug, appointmentId, managementToken),
      evidenceId,
    );
  }

  private async upload(
    access: ManagementAccess,
    scope: AppointmentEvidenceScope,
    dto: UploadAppointmentEvidenceDto,
    file?: Express.Multer.File,
  ): Promise<AppointmentEvidenceView> {
    const appointment = await this.accesses.load(access);
    this.assertStatus(appointment, scope);
    assertAppointmentEvidenceFile(file);
    const mimeType = file.mimetype as AppointmentEvidenceEntity['mimeType'];
    const requestFingerprint = createHash('sha256')
      .update(scope)
      .update('\0')
      .update(file.mimetype)
      .update('\0')
      .update(file.buffer)
      .digest('hex');
    const replay = await this.findReplay(access, dto.idempotencyKey);
    if (replay) return this.replayView(replay, requestFingerprint);

    const stored = await this.storage.uploadPrivateImage(
      access.tenantId,
      access.appointmentId,
      file,
    );
    const evidenceId = randomUUID();
    try {
      const evidence = await this.database.withTransaction(async (session) => {
        const current = await this.accesses.load(access, session);
        this.assertStatus(current, scope);
        const [created] = await this.database.models.appointmentEvidence.create(
          [
            {
              _id: evidenceId,
              tenantId: access.tenantId,
              appointmentId: access.appointmentId,
              customerId: current.customerId,
              scope,
              actorType: access.actorType,
              ...(access.actorUserId
                ? { actorUserId: access.actorUserId }
                : {}),
              ...stored,
              mimeType,
              originalFileName: safeEvidenceFileName(file.originalname),
              idempotencyKey: dto.idempotencyKey,
              requestFingerprint,
            },
          ],
          { session },
        );
        await this.effects.recordEvidence(
          access,
          evidenceId,
          dto.idempotencyKey,
          requestFingerprint,
          session,
        );
        return created.toObject();
      });
      return this.view(evidence);
    } catch (error) {
      await this.storage.deletePrivateImage(stored.storageKey);
      if (
        isNamedDuplicateKey(error, INDEX_NAMES.appointmentEvidenceIdempotency)
      ) {
        const existing = await this.findReplay(access, dto.idempotencyKey);
        if (existing) return this.replayView(existing, requestFingerprint);
      }
      throw error;
    }
  }

  private async access(
    access: ManagementAccess,
    evidenceId: string,
  ): Promise<AppointmentEvidenceView> {
    const appointment = await this.accesses.load(access);
    const evidence = await this.database.models.appointmentEvidence
      .findOne({
        _id: evidenceId,
        tenantId: access.tenantId,
        appointmentId: access.appointmentId,
        ...(access.publicOnly
          ? {
              customerId: appointment.customerId,
              scope: 'SURVEY',
              actorType: 'CUSTOMER',
            }
          : {}),
      })
      .lean()
      .exec();
    if (!evidence) throw evidenceNotFound();
    return this.view(evidence);
  }

  private async findReplay(
    access: ManagementAccess,
    idempotencyKey: string,
  ): Promise<AppointmentEvidenceEntity | null> {
    return this.database.models.appointmentEvidence
      .findOne({
        tenantId: access.tenantId,
        appointmentId: access.appointmentId,
        idempotencyKey,
      })
      .lean()
      .exec();
  }

  private replayView(
    evidence: AppointmentEvidenceEntity,
    requestFingerprint: string,
  ): AppointmentEvidenceView {
    if (evidence.requestFingerprint !== requestFingerprint) {
      throw new AppException(
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'Idempotency key was already used with different input',
      );
    }
    return this.view(evidence);
  }

  private view(evidence: AppointmentEvidenceEntity): AppointmentEvidenceView {
    return appointmentEvidenceView(
      evidence,
      this.storage.signedUrl(evidence.storageKey, evidence.format),
    );
  }

  private assertStatus(
    appointment: AppointmentEntity,
    scope: AppointmentEvidenceScope,
  ): void {
    const allowed =
      scope === 'SURVEY'
        ? ['COMPLETED']
        : ['IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];
    if (!allowed.includes(appointment.status)) {
      throw new AppException(
        409,
        'APPOINTMENT_EVIDENCE_STATUS_INVALID',
        'Appointment does not accept evidence in its current status',
      );
    }
  }
}

function evidenceNotFound(): AppException {
  return new AppException(
    404,
    'APPOINTMENT_EVIDENCE_NOT_FOUND',
    'Appointment evidence was not found',
  );
}
