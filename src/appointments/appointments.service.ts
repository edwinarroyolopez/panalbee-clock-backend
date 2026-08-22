import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AccountPublicAccessService } from '../accounts/account-public-access.service';
import type { TenantOperationAuthContext } from '../auth/auth.types';
import { AvailabilityService } from '../availability/availability.service';
import { AppException } from '../common/app-exception';
import { Environment } from '../config/environment';
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
import { AppointmentEffectsService } from './appointment-effects.service';
import { AppointmentIntervalLockService } from './appointment-interval-lock.service';
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
    private readonly config: ConfigService<Environment, true>,
    private readonly publicAccess: AccountPublicAccessService,
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
    const normalized = normalizeCommon(dto);
    return this.create({
      tenantId: actor.tenant.id,
      ...normalized,
      customerId: dto.customerId,
      source: 'ADMIN',
      actorUserId: actor.userId,
      actorType:
        actor.actorType === 'DELEGATED' ? 'INTERNAL_USER' : 'TENANT_USER',
      publicOnly: false,
      fingerprint: fingerprint({ ...normalized, customerId: dto.customerId }),
    });
  }

  async createPublic(
    tenantSlug: string,
    dto: CreatePublicAppointmentDto,
  ): Promise<PublicAppointmentResult> {
    const { tenant } = await this.publicAccess.resolve(tenantSlug, {
      requireBooking: true,
    });
    const normalized = normalizeCommon(dto);
    const publicCustomer = {
      name: dto.customerName.trim(),
      phone: dto.customerPhone,
      email: dto.customerEmail?.toLowerCase() ?? null,
    };
    return this.create({
      tenantId: tenant._id,
      ...normalized,
      publicCustomer,
      source: 'WEB',
      actorUserId: null,
      actorType: 'CUSTOMER',
      publicOnly: true,
      fingerprint: fingerprint({ ...normalized, ...publicCustomer }),
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
        if (replay) return this.withManagementToken(replay, intent);

        const customerId = intent.publicCustomer
          ? await this.store.upsertPublicCustomer(intent, session)
          : intent.customerId!;
        const relation = await this.store.validateRelations(
          intent,
          customerId,
          session,
        );
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
          ? this.managementToken(appointmentId)
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
        if (replay) return this.withManagementToken(replay, intent);
      }
      throw error;
    }
  }

  private withManagementToken(
    appointment: AppointmentView,
    intent: CreateIntent,
  ): PublicAppointmentResult {
    return {
      ...appointment,
      ...(intent.publicCustomer
        ? { managementToken: this.managementToken(appointment.id) }
        : {}),
    };
  }

  private managementToken(appointmentId: string): string {
    return createHmac(
      'sha256',
      this.config.get('MANAGEMENT_TOKEN_SECRET', { infer: true }),
    )
      .update(`appointment:${appointmentId}`)
      .digest('base64url');
  }
}

function normalizeCommon(
  dto: CreateTenantAppointmentDto | CreatePublicAppointmentDto,
) {
  return {
    locationId: dto.locationId,
    serviceId: dto.serviceId,
    staffId: dto.staffId,
    startsAt: new Date(dto.startsAt).toISOString(),
    idempotencyKey: dto.idempotencyKey,
    notes: dto.notes?.trim() || null,
  };
}

function fingerprint(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
