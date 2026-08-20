import { Injectable } from '@nestjs/common';
import { DateTime, IANAZone } from 'luxon';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { AppointmentEntity } from '../database/models';

export interface RescheduleRelation {
  durationMinutes: number;
  localDate: string;
}

@Injectable()
export class AppointmentRescheduleRelationService {
  constructor(private readonly database: DatabaseService) {}

  async resolve(
    tenantId: string,
    publicOnly: boolean,
    appointment: AppointmentEntity,
    startsAt: Date,
    session: ClientSession,
  ): Promise<RescheduleRelation> {
    const location = await this.database.models.location
      .findOne({
        _id: appointment.locationId,
        tenantId,
        ...(publicOnly ? { publicBookingEnabled: true } : {}),
      })
      .session(session)
      .lean()
      .exec();
    const service = await this.database.models.service
      .findOne({ _id: appointment.serviceId, tenantId, active: true })
      .session(session)
      .lean()
      .exec();
    const staff = await this.database.models.staff
      .findOne({
        _id: appointment.staffId,
        tenantId,
        locationId: appointment.locationId,
        active: true,
      })
      .session(session)
      .lean()
      .exec();
    const staffService = await this.database.models.staffService
      .findOne({
        tenantId,
        staffId: appointment.staffId,
        serviceId: appointment.serviceId,
      })
      .session(session)
      .lean()
      .exec();
    if (!location || !service || !staff || !staffService) {
      throw new AppException(
        404,
        'APPOINTMENT_NOT_FOUND',
        'Appointment not found',
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
      localDate: DateTime.fromJSDate(startsAt, { zone: 'utc' })
        .setZone(location.timezone)
        .toISODate()!,
    };
  }
}
