import { Injectable } from '@nestjs/common';
import { DateTime, IANAZone } from 'luxon';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { AppointmentView, appointmentView } from './appointment.view';

export interface CreateIntent {
  tenantId: string;
  locationId: string;
  serviceId: string;
  staffId: string;
  customerId?: string;
  publicCustomer?: {
    name: string;
    phone: string;
    email: string | null;
  };
  startsAt: string;
  idempotencyKey: string;
  notes: string | null;
  source: 'ADMIN' | 'WEB';
  actorUserId: string | null;
  publicOnly: boolean;
  fingerprint: string;
}

export interface AppointmentRelation {
  durationMinutes: number;
  localDate: string;
}

@Injectable()
export class AppointmentCreationStore {
  constructor(private readonly database: DatabaseService) {}

  async findReplay(
    intent: CreateIntent,
    session?: ClientSession,
  ): Promise<AppointmentView | undefined> {
    const appointment = await this.database.models.appointment
      .findOne({
        tenantId: intent.tenantId,
        idempotencyKey: intent.idempotencyKey,
      })
      .session(session ?? null)
      .lean()
      .exec();
    if (!appointment) return undefined;
    if (appointment.requestFingerprint !== intent.fingerprint) {
      throw new AppException(
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'Idempotency key was already used with a different request',
      );
    }
    return appointmentView(appointment);
  }

  async upsertPublicCustomer(
    intent: CreateIntent,
    session: ClientSession,
  ): Promise<string> {
    const input = intent.publicCustomer!;
    const existing = await this.database.models.customer
      .findOne({ tenantId: intent.tenantId, phone: input.phone })
      .session(session)
      .exec();
    if (existing) {
      if (!existing.email && input.email) {
        existing.email = input.email;
        await existing.save({ session });
      }
      return existing._id;
    }
    const [customer] = await this.database.models.customer.create(
      [
        {
          tenantId: intent.tenantId,
          fullName: input.name,
          phone: input.phone,
          ...(input.email ? { email: input.email } : {}),
        },
      ],
      { session },
    );
    return customer._id;
  }

  async validateRelations(
    intent: CreateIntent,
    customerId: string,
    session: ClientSession,
  ): Promise<AppointmentRelation> {
    const tenant = await this.database.models.tenant
      .findOne({ _id: intent.tenantId, status: 'ACTIVE' })
      .session(session)
      .lean()
      .exec();
    const location = await this.database.models.location
      .findOne({ _id: intent.locationId, tenantId: intent.tenantId })
      .session(session)
      .lean()
      .exec();
    const service = await this.database.models.service
      .findOne({
        _id: intent.serviceId,
        tenantId: intent.tenantId,
        active: true,
      })
      .session(session)
      .lean()
      .exec();
    const staff = await this.database.models.staff
      .findOne({
        _id: intent.staffId,
        tenantId: intent.tenantId,
        locationId: intent.locationId,
        active: true,
      })
      .session(session)
      .lean()
      .exec();
    const staffService = await this.database.models.staffService
      .findOne({
        tenantId: intent.tenantId,
        staffId: intent.staffId,
        serviceId: intent.serviceId,
      })
      .session(session)
      .lean()
      .exec();
    const customer = await this.database.models.customer
      .exists({ _id: customerId, tenantId: intent.tenantId })
      .session(session)
      .exec();
    if (
      !tenant ||
      !location ||
      !service ||
      !staff ||
      !staffService ||
      !customer ||
      (intent.publicOnly && !location.publicBookingEnabled)
    ) {
      throw new AppException(
        404,
        'APPOINTMENT_RELATION_NOT_FOUND',
        'Appointment resources were not found together',
      );
    }
    if (!IANAZone.isValidZone(location.timezone)) {
      throw new AppException(
        422,
        'LOCATION_TIMEZONE_INVALID',
        'Location timezone is invalid',
      );
    }
    return {
      durationMinutes:
        staffService.durationOverrideMinutes ?? service.durationMinutes,
      localDate: DateTime.fromISO(intent.startsAt, { setZone: true })
        .setZone(location.timezone)
        .toISODate()!,
    };
  }
}
