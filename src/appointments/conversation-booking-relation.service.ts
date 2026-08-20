import { Injectable } from '@nestjs/common';
import { DateTime, IANAZone } from 'luxon';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';

interface ConversationBookingRelation {
  locationId: string;
  durationMinutes: number;
  startsAt: Date;
}

@Injectable()
export class ConversationBookingRelationService {
  constructor(private readonly database: DatabaseService) {}

  async resolve(
    tenantId: string,
    customerId: string,
    serviceId: string,
    staffId: string,
    date: string,
    time: string,
    session: ClientSession,
  ): Promise<ConversationBookingRelation> {
    assertDateTime(date, time);
    const tenant = await this.database.models.tenant
      .exists({ _id: tenantId, status: 'ACTIVE' })
      .session(session)
      .exec();
    const customer = await this.database.models.customer
      .exists({ _id: customerId, tenantId })
      .session(session)
      .exec();
    const staff = await this.database.models.staff
      .findOne({ _id: staffId, tenantId, active: true })
      .session(session)
      .lean()
      .exec();
    const service = await this.database.models.service
      .findOne({ _id: serviceId, tenantId, active: true })
      .session(session)
      .lean()
      .exec();
    const staffService = await this.database.models.staffService
      .findOne({ tenantId, staffId, serviceId })
      .session(session)
      .lean()
      .exec();
    const location = staff
      ? await this.database.models.location
          .findOne({ _id: staff.locationId, tenantId })
          .session(session)
          .lean()
          .exec()
      : null;
    if (
      !tenant ||
      !customer ||
      !staff ||
      !service ||
      !staffService ||
      !location
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
    const localInput = `${date}T${time}`;
    const startsAt = DateTime.fromISO(localInput, {
      zone: location.timezone,
      setZone: true,
    });
    if (
      !startsAt.isValid ||
      startsAt.toFormat("yyyy-MM-dd'T'HH:mm") !== localInput
    ) {
      throw invalidInput();
    }
    return {
      locationId: location._id,
      durationMinutes:
        staffService.durationOverrideMinutes ?? service.durationMinutes,
      startsAt: startsAt.toJSDate(),
    };
  }
}

function assertDateTime(date: string, time: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw invalidInput();
  }
}

function invalidInput(): AppException {
  return new AppException(
    400,
    'CONVERSATION_BOOKING_INPUT_INVALID',
    'Booking date or time is invalid',
  );
}
