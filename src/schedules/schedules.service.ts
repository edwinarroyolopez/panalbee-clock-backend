import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  AvailabilityExceptionEntity,
  INDEX_NAMES,
  isNamedDuplicateKey,
  ScheduleEntity,
} from '../database/models';
import {
  CreateAvailabilityExceptionDto,
  CreateScheduleDto,
  ExceptionListQueryDto,
  ScheduleListQueryDto,
} from './schedule.dto';

export interface ScheduleView {
  id: string;
  locationId: string;
  staffId: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
}

export interface AvailabilityExceptionView {
  id: string;
  locationId: string;
  staffId: string;
  kind: 'AVAILABLE' | 'UNAVAILABLE';
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

@Injectable()
export class SchedulesService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    tenantId: string,
    query: ScheduleListQueryDto,
  ): Promise<{ items: ScheduleView[] }> {
    const schedules = await this.database.models.schedule
      .find({
        tenantId,
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.staffId ? { staffId: query.staffId } : {}),
      })
      .sort({ dayOfWeek: 1, startsAt: 1, _id: 1 })
      .lean()
      .exec();
    return { items: schedules.map(scheduleView) };
  }

  async create(
    tenantId: string,
    dto: CreateScheduleDto,
  ): Promise<ScheduleView> {
    if (dto.startsAt >= dto.endsAt) {
      throw new AppException(
        400,
        'SCHEDULE_INTERVAL_INVALID',
        'Schedule start must be before end',
      );
    }
    await this.requireStaffLocation(tenantId, dto.locationId, dto.staffId);
    try {
      const schedule = await this.database.models.schedule.create({
        tenantId,
        locationId: dto.locationId,
        staffId: dto.staffId,
        dayOfWeek: dto.dayOfWeek,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
      });
      return scheduleView(schedule.toObject());
    } catch (error) {
      if (isNamedDuplicateKey(error, INDEX_NAMES.schedule)) {
        throw new AppException(
          409,
          'SCHEDULE_CONFLICT',
          'This schedule already exists',
        );
      }
      throw error;
    }
  }

  async listExceptions(
    tenantId: string,
    query: ExceptionListQueryDto,
  ): Promise<{ items: AvailabilityExceptionView[] }> {
    const exceptions = await this.database.models.availabilityException
      .find({
        tenantId,
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.staffId ? { staffId: query.staffId } : {}),
      })
      .sort({ startsAt: 1, _id: 1 })
      .lean()
      .exec();
    return { items: exceptions.map(exceptionView) };
  }

  async createException(
    tenantId: string,
    dto: CreateAvailabilityExceptionDto,
  ): Promise<AvailabilityExceptionView> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (startsAt.getTime() >= endsAt.getTime()) {
      throw new AppException(
        400,
        'AVAILABILITY_EXCEPTION_INTERVAL_INVALID',
        'Exception start must be before end',
      );
    }
    await this.requireStaffLocation(tenantId, dto.locationId, dto.staffId);
    const exception = await this.database.models.availabilityException.create({
      tenantId,
      locationId: dto.locationId,
      staffId: dto.staffId,
      kind: dto.kind,
      startsAt,
      endsAt,
      ...(dto.reason?.trim() ? { reason: dto.reason.trim() } : {}),
    });
    return exceptionView(exception.toObject());
  }

  private async requireStaffLocation(
    tenantId: string,
    locationId: string,
    staffId: string,
  ): Promise<void> {
    const staff = await this.database.models.staff
      .exists({ _id: staffId, tenantId, locationId })
      .exec();
    if (!staff) {
      throw new AppException(
        404,
        'STAFF_LOCATION_NOT_FOUND',
        'Staff member and location were not found together',
      );
    }
  }
}

function scheduleView(schedule: ScheduleEntity): ScheduleView {
  return {
    id: schedule._id,
    locationId: schedule.locationId,
    staffId: schedule.staffId,
    dayOfWeek: schedule.dayOfWeek,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
  };
}

function exceptionView(
  exception: AvailabilityExceptionEntity,
): AvailabilityExceptionView {
  return {
    id: exception._id,
    locationId: exception.locationId,
    staffId: exception.staffId,
    kind: exception.kind,
    startsAt: exception.startsAt.toISOString(),
    endsAt: exception.endsAt.toISOString(),
    reason: exception.reason ?? null,
  };
}
