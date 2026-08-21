import { Injectable } from '@nestjs/common';
import { DateTime, IANAZone } from 'luxon';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { AvailabilityQueryDto } from './availability.dto';
import {
  AvailabilitySlot,
  buildAvailabilitySlots,
} from './availability-calculator';

export type { AvailabilitySlot } from './availability-calculator';

interface ComputeOptions {
  publicOnly?: boolean;
  session?: ClientSession;
  excludeAppointmentId?: string;
  appointmentConflict?: boolean;
  ignoreAppointments?: boolean;
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly database: DatabaseService) {}

  async listForTenant(
    tenantId: string,
    query: AvailabilityQueryDto,
  ): Promise<{ items: AvailabilitySlot[] }> {
    return { items: await this.compute(tenantId, query) };
  }

  async listPublic(
    tenantSlug: string,
    query: AvailabilityQueryDto,
  ): Promise<{ items: AvailabilitySlot[] }> {
    const tenant = await this.database.models.tenant
      .findOne({ slug: tenantSlug, status: 'ACTIVE' })
      .lean()
      .exec();
    if (!tenant) {
      throw new AppException(404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }
    return {
      items: await this.compute(tenant._id, query, { publicOnly: true }),
    };
  }

  async assertSlotAvailable(
    tenantId: string,
    query: AvailabilityQueryDto,
    startsAt: string,
    options: ComputeOptions = {},
  ): Promise<void> {
    const requested = new Date(startsAt).getTime();
    const slots = await this.compute(tenantId, query, options);
    if (hasRequestedSlot(slots, requested)) return;

    if (options.appointmentConflict) {
      const potential = await this.compute(tenantId, query, {
        ...options,
        appointmentConflict: false,
        ignoreAppointments: true,
      });
      if (hasRequestedSlot(potential, requested)) {
        throw new AppException(
          409,
          'APPOINTMENT_SLOT_CONFLICT',
          'The requested appointment slot is no longer available',
        );
      }
    }
    throw new AppException(
      409,
      'APPOINTMENT_SLOT_UNAVAILABLE',
      'The requested appointment slot is unavailable',
    );
  }

  private async compute(
    tenantId: string,
    query: AvailabilityQueryDto,
    options: ComputeOptions = {},
  ): Promise<AvailabilitySlot[]> {
    const session = options.session ?? null;
    const tenant = await this.database.models.tenant
      .findOne({ _id: tenantId, status: 'ACTIVE' })
      .session(session)
      .lean()
      .exec();
    const location = await this.database.models.location
      .findOne({ _id: query.locationId, tenantId })
      .session(session)
      .lean()
      .exec();
    const service = await this.database.models.service
      .findOne({ _id: query.serviceId, tenantId, active: true })
      .session(session)
      .lean()
      .exec();
    if (
      !tenant ||
      !location ||
      !service ||
      (options.publicOnly && !location.publicBookingEnabled)
    ) {
      throw new AppException(
        404,
        'AVAILABILITY_CONTEXT_NOT_FOUND',
        'Location and service were not found together',
      );
    }
    if (!IANAZone.isValidZone(location.timezone)) {
      throw new AppException(
        422,
        'LOCATION_TIMEZONE_INVALID',
        'Location timezone is invalid',
      );
    }

    const staffServices = await this.database.models.staffService
      .find({
        tenantId,
        serviceId: service._id,
        ...(query.staffId ? { staffId: query.staffId } : {}),
      })
      .session(session)
      .lean()
      .exec();
    const staff = await this.database.models.staff
      .find({
        _id: { $in: staffServices.map((item) => item.staffId) },
        tenantId,
        locationId: location._id,
        active: true,
      })
      .session(session)
      .lean()
      .exec();
    const staffById = new Map(staff.map((item) => [item._id, item]));
    const eligible = staffServices.flatMap((item) => {
      const member = staffById.get(item.staffId);
      return member
        ? [
            {
              id: member._id,
              name: member.displayName,
              durationMinutes:
                item.durationOverrideMinutes ?? service.durationMinutes,
            },
          ]
        : [];
    });
    if (query.staffId && eligible.length === 0) {
      throw new AppException(
        404,
        'STAFF_SERVICE_NOT_FOUND',
        'Active staff eligibility was not found',
      );
    }
    if (eligible.length === 0) return [];

    const day = DateTime.fromISO(query.date, { zone: location.timezone });
    const dayStart = day.startOf('day');
    const dayEnd = dayStart.plus({ days: 1 });
    const staffIds = eligible.map(({ id }) => id);
    const schedules = await this.database.models.schedule
      .find({
        tenantId,
        locationId: location._id,
        staffId: { $in: staffIds },
        dayOfWeek: day.weekday % 7,
      })
      .session(session)
      .lean()
      .exec();
    const exceptions = await this.database.models.availabilityException
      .find({
        tenantId,
        locationId: location._id,
        staffId: { $in: staffIds },
        startsAt: { $lt: dayEnd.toJSDate() },
        endsAt: { $gt: dayStart.toJSDate() },
      })
      .session(session)
      .lean()
      .exec();
    const appointments = options.ignoreAppointments
      ? []
      : await this.database.models.appointment
          .find({
            tenantId,
            locationId: location._id,
            staffId: { $in: staffIds },
            status: { $in: ['PENDING', 'CONFIRMED'] },
            startsAt: { $lt: dayEnd.toJSDate() },
            endsAt: { $gt: dayStart.toJSDate() },
            ...(options.excludeAppointmentId
              ? { _id: { $ne: options.excludeAppointmentId } }
              : {}),
          })
          .session(session)
          .lean()
          .exec();

    return buildAvailabilitySlots({
      date: query.date,
      timezone: location.timezone,
      eligible,
      schedules,
      exceptions,
      appointments,
    });
  }
}

function hasRequestedSlot(
  slots: AvailabilitySlot[],
  requested: number,
): boolean {
  return slots.some((slot) => new Date(slot.startsAt).getTime() === requested);
}
