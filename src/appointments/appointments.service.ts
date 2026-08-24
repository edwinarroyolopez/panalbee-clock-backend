import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccountPublicAccessService } from '../accounts/account-public-access.service';
import { ReferralAttributionService } from '../affiliates/referral-attribution.service';
import { normalizeAffiliateCode } from '../affiliates/affiliate-economics';
import type { TenantOperationAuthContext } from '../auth/auth.types';
import { AvailabilityService } from '../availability/availability.service';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  AppointmentStatus,
  INDEX_NAMES,
  isNamedDuplicateKey,
} from '../database/models';
import {
  AppointmentCreationStore,
  CreateIntent,
} from './appointment-creation.store';
import {
  appointmentFingerprint,
  normalizeCreateInput,
  tokenHash,
} from './appointment-create-input';
import { AppointmentEffectsService } from './appointment-effects.service';
import { AppointmentIntervalLockService } from './appointment-interval-lock.service';
import { AppointmentResultService } from './appointment-result.service';
import {
  AppointmentListQueryDto,
  CreatePublicAppointmentDto,
  CreateTenantAppointmentDto,
} from './appointment.dto';
import {
  AppointmentView,
  PublicAppointmentResult,
  appointmentView,
} from './appointment.view';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly availability: AvailabilityService,
    private readonly store: AppointmentCreationStore,
    private readonly effects: AppointmentEffectsService,
    private readonly intervalLocks: AppointmentIntervalLockService,
    private readonly publicAccess: AccountPublicAccessService,
    private readonly attributions: ReferralAttributionService,
    private readonly results: AppointmentResultService,
  ) {}

  async list(
    tenantId: string,
    query: AppointmentListQueryDto,
  ): Promise<{ items: AppointmentView[] }> {
    if (query.attention && query.status) {
      throw new AppException(
        400,
        'APPOINTMENT_FILTER_CONFLICT',
        'Status and attention filters cannot be combined',
      );
    }
    const appointments = await this.database.models.appointment
      .find({
        tenantId,
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.staffId ? { staffId: query.staffId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.attention === 'OUTCOME_REQUIRED'
          ? {
              status: { $in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] },
              endsAt: { $lte: new Date() },
            }
          : query.status
            ? { status: query.status as AppointmentStatus }
            : {}),
        ...(query.from || query.to
          ? {
              startsAt: {
                ...(query.from ? { $gte: new Date(query.from) } : {}),
                ...(query.to ? { $lt: new Date(query.to) } : {}),
              },
            }
          : {}),
      })
      .sort({ startsAt: 1, _id: 1 })
      .lean()
      .exec();
    return {
      items: appointments.map((appointment) => appointmentView(appointment)),
    };
  }

  async createTenant(
    actor: TenantOperationAuthContext,
    dto: CreateTenantAppointmentDto,
  ): Promise<AppointmentView> {
    const normalized = normalizeCreateInput(dto);
    return this.create({
      tenantId: actor.tenant.id,
      ...normalized,
      customerId: dto.customerId,
      source: 'ADMIN',
      actorUserId: actor.userId,
      actorType:
        actor.actorType === 'DELEGATED' ? 'INTERNAL_USER' : 'TENANT_USER',
      publicOnly: false,
      fingerprint: appointmentFingerprint({
        ...normalized,
        customerId: dto.customerId,
      }),
    });
  }

  async createPublic(
    tenantSlug: string,
    dto: CreatePublicAppointmentDto,
  ): Promise<PublicAppointmentResult> {
    const { tenant } = await this.publicAccess.resolve(tenantSlug, {
      requireBooking: true,
    });
    const normalized = normalizeCreateInput(dto);
    const publicCustomer = {
      name: dto.customerName.trim(),
      phone: dto.customerPhone,
      email: dto.customerEmail?.toLowerCase() ?? null,
    };
    const referralCode = dto.referralCode
      ? normalizeAffiliateCode(dto.referralCode)
      : undefined;
    return this.create({
      tenantId: tenant._id,
      ...normalized,
      publicCustomer,
      source: 'WEB',
      actorUserId: null,
      actorType: 'CUSTOMER',
      publicOnly: true,
      ...(referralCode ? { referralCode } : {}),
      fingerprint: appointmentFingerprint({
        ...normalized,
        ...publicCustomer,
        ...(referralCode ? { referralCode } : {}),
      }),
    });
  }

  private async create(
    intent: CreateIntent,
    retryCustomerConflict = true,
  ): Promise<PublicAppointmentResult> {
    try {
      return await this.database.withTransaction(async (session) => {
        if (intent.publicOnly) {
          await this.publicAccess.assertTenantBookingEnabled(
            intent.tenantId,
            session,
          );
        }
        const replay = await this.store.findReplay(intent, session);
        if (replay) return this.results.replay(replay, intent, session);

        const customerId = intent.publicCustomer
          ? await this.store.upsertPublicCustomer(intent, session)
          : intent.customerId!;
        const relation = await this.store.validateRelations(
          intent,
          customerId,
          session,
        );
        const attribution = intent.referralCode
          ? await this.attributions.prepare(
              intent.tenantId,
              intent.referralCode,
              customerId,
              relation.service,
              session,
            )
          : undefined;
        await this.availability.assertSlotAvailable(
          intent.tenantId,
          {
            locationId: intent.locationId,
            serviceId: intent.serviceId,
            staffId: intent.staffId,
            date: relation.localDate,
          },
          intent.startsAt,
          {
            session,
            publicOnly: intent.publicOnly,
            appointmentConflict: true,
          },
        );

        const appointmentId = randomUUID();
        const managementToken = intent.publicCustomer
          ? this.results.managementToken(appointmentId)
          : undefined;
        const startsAt = new Date(intent.startsAt);
        const endsAt = new Date(
          startsAt.getTime() + relation.durationMinutes * 60_000,
        );
        const [appointment] = await this.database.models.appointment.create(
          [
            {
              _id: appointmentId,
              tenantId: intent.tenantId,
              locationId: intent.locationId,
              serviceId: intent.serviceId,
              staffId: intent.staffId,
              customerId,
              startsAt,
              endsAt,
              sourceChannel: intent.source,
              idempotencyKey: intent.idempotencyKey,
              requestFingerprint: intent.fingerprint,
              ...(managementToken
                ? { managementTokenHash: tokenHash(managementToken) }
                : {}),
              ...(intent.notes ? { notes: intent.notes } : {}),
            },
          ],
          { session },
        );
        const referral = attribution
          ? await this.attributions.record(
              intent.tenantId,
              appointment._id,
              customerId,
              intent.serviceId,
              attribution,
              session,
            )
          : undefined;
        await this.intervalLocks.acquire(
          intent.tenantId,
          intent.staffId,
          appointment._id,
          startsAt,
          endsAt,
          session,
        );
        await this.effects.recordCreated(
          session,
          intent.tenantId,
          intent.actorUserId,
          intent.actorType,
          appointment,
        );
        return {
          ...appointmentView(appointment.toObject()),
          ...(managementToken ? { managementToken } : {}),
          ...(referral ? { referral } : {}),
        };
      });
    } catch (error) {
      if (
        retryCustomerConflict &&
        isNamedDuplicateKey(error, INDEX_NAMES.customerPhone)
      ) {
        return this.create(intent, false);
      }
      if (isNamedDuplicateKey(error, INDEX_NAMES.appointmentIdempotency)) {
        const replay = await this.store.findReplay(intent);
        if (replay) return this.results.replay(replay, intent);
      }
      throw error;
    }
  }
}
