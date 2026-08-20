import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { INDEX_NAMES, isNamedDuplicateKey } from '../database/models';

@Injectable()
export class AppointmentIntervalLockService {
  constructor(private readonly database: DatabaseService) {}

  async acquire(
    tenantId: string,
    staffId: string,
    appointmentId: string,
    startsAt: Date,
    endsAt: Date,
    session: ClientSession,
  ): Promise<void> {
    const intervalStarts = minuteStarts(startsAt, endsAt);
    try {
      await this.database.models.appointmentIntervalLock.insertMany(
        intervalStarts.map((intervalStart) => ({
          tenantId,
          staffId,
          appointmentId,
          intervalStart,
        })),
        { session, ordered: true },
      );
    } catch (error) {
      if (isNamedDuplicateKey(error, INDEX_NAMES.appointmentIntervalLock)) {
        throw slotConflict();
      }
      throw error;
    }
  }

  async release(
    tenantId: string,
    appointmentId: string,
    session: ClientSession,
  ): Promise<void> {
    await this.database.models.appointmentIntervalLock
      .deleteMany({ tenantId, appointmentId })
      .session(session)
      .exec();
  }

  async replace(
    tenantId: string,
    staffId: string,
    appointmentId: string,
    startsAt: Date,
    endsAt: Date,
    session: ClientSession,
  ): Promise<void> {
    await this.release(tenantId, appointmentId, session);
    await this.acquire(
      tenantId,
      staffId,
      appointmentId,
      startsAt,
      endsAt,
      session,
    );
  }
}

function minuteStarts(startsAt: Date, endsAt: Date): Date[] {
  if (
    startsAt.getTime() >= endsAt.getTime() ||
    startsAt.getUTCSeconds() !== 0 ||
    startsAt.getUTCMilliseconds() !== 0 ||
    endsAt.getUTCSeconds() !== 0 ||
    endsAt.getUTCMilliseconds() !== 0
  ) {
    throw new Error(
      'Appointment lock intervals must be ordered and minute-aligned',
    );
  }
  const result: Date[] = [];
  for (
    let cursor = startsAt.getTime();
    cursor < endsAt.getTime();
    cursor += 60_000
  ) {
    result.push(new Date(cursor));
  }
  return result;
}

function slotConflict(): AppException {
  return new AppException(
    409,
    'APPOINTMENT_SLOT_CONFLICT',
    'The requested appointment slot is no longer available',
  );
}
