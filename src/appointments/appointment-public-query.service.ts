import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DatabaseService } from '../database/database.service';
import { AppointmentView, appointmentView } from './appointment.view';
import { tokenHash } from './appointments.service';

@Injectable()
export class AppointmentPublicQueryService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    tenantSlug: string,
    managementToken: string,
  ): Promise<{ items: AppointmentView[] }> {
    const tenant = await this.database.models.tenant
      .findOne({ slug: tenantSlug, status: 'ACTIVE' })
      .lean()
      .exec();
    if (!tenant) return { items: [] };
    const appointments = await this.database.models.appointment
      .find({
        tenantId: tenant._id,
        managementTokenHash: tokenHash(managementToken),
      })
      .sort({ startsAt: 1, _id: 1 })
      .lean()
      .exec();
    if (appointments.length === 0) return { items: [] };

    const [locations, services, staff] = await Promise.all([
      this.database.models.location
        .find({
          tenantId: tenant._id,
          _id: { $in: appointments.map((item) => item.locationId) },
        })
        .lean()
        .exec(),
      this.database.models.service
        .find({
          tenantId: tenant._id,
          _id: { $in: appointments.map((item) => item.serviceId) },
        })
        .lean()
        .exec(),
      this.database.models.staff
        .find({
          tenantId: tenant._id,
          _id: { $in: appointments.map((item) => item.staffId) },
        })
        .lean()
        .exec(),
    ]);
    const locationsById = new Map(locations.map((item) => [item._id, item]));
    const servicesById = new Map(services.map((item) => [item._id, item]));
    const staffById = new Map(staff.map((item) => [item._id, item]));
    return {
      items: appointments.flatMap((appointment) => {
        const location = locationsById.get(appointment.locationId);
        const service = servicesById.get(appointment.serviceId);
        const member = staffById.get(appointment.staffId);
        if (!location || !service || !member) return [];
        return [
          appointmentView({
            ...appointment,
            locationName: location.name,
            timezone: location.timezone,
            serviceName: service.name,
            staffName: member.displayName,
            localStartsAt: localLabel(appointment.startsAt, location.timezone),
            localEndsAt: localLabel(appointment.endsAt, location.timezone),
          }),
        ];
      }),
    };
  }
}

function localLabel(value: Date, timezone: string): string {
  return DateTime.fromJSDate(value, { zone: 'utc' })
    .setZone(timezone)
    .toFormat("yyyy-MM-dd'T'HH:mm");
}
