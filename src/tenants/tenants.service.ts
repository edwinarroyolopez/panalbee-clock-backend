import { Injectable } from '@nestjs/common';
import { AccountPublicAccessService } from '../accounts/account-public-access.service';
import { accountProfileView } from '../accounts/account.views';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { LocationEntity, ScheduleEntity } from '../database/models';

export interface TenantView {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface LocationView {
  id: string;
  name: string;
  timezone: string;
  publicBookingEnabled: boolean;
}

export interface BusinessHoursInterval {
  startsAt: string;
  endsAt: string;
}

export interface PublicLocationBusinessHours {
  locationId: string;
  dayOfWeek: number;
  intervals: BusinessHoursInterval[];
}

export interface PublicTenantContext {
  name: string;
  slug: string;
  locations: LocationView[];
  businessHours: PublicLocationBusinessHours[];
  headline?: string;
  description?: string;
  logo?: string | null;
  coverImage?: string | null;
  theme?: string;
  contactInfo?: {
    phone: string | null;
    email: string | null;
    website: string | null;
  };
  bookingEnabled?: boolean;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly publicAccess: AccountPublicAccessService,
  ) {}

  async current(tenantId: string): Promise<TenantView> {
    const tenant = await this.database.models.tenant
      .findOne({ _id: tenantId, status: 'ACTIVE' })
      .lean()
      .exec();
    if (!tenant) throw this.notFound('TENANT_NOT_FOUND', 'Tenant not found');
    return {
      id: tenant._id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
    };
  }

  async publicContext(slug: string): Promise<PublicTenantContext> {
    const access = await this.publicAccess.resolve(slug);
    const { tenant } = access;
    const locations = await this.database.models.location
      .find({ tenantId: tenant._id, publicBookingEnabled: true })
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
    const staff = await this.database.models.staff
      .find({
        tenantId: tenant._id,
        locationId: { $in: locations.map(({ _id }) => _id) },
        active: true,
      })
      .lean()
      .exec();
    const relations = await this.database.models.staffService
      .find({
        tenantId: tenant._id,
        staffId: { $in: staff.map(({ _id }) => _id) },
      })
      .lean()
      .exec();
    const activeServiceIds = new Set(
      await this.database.models.service.distinct('_id', {
        tenantId: tenant._id,
        active: true,
        _id: { $in: relations.map(({ serviceId }) => serviceId) },
      }),
    );
    const eligibleStaffIds = new Set(
      relations
        .filter(({ serviceId }) => activeServiceIds.has(serviceId))
        .map(({ staffId }) => staffId),
    );
    const staffLocations = new Map(
      staff.map(({ _id, locationId }) => [_id, locationId]),
    );
    const schedules = await this.database.models.schedule
      .find({
        tenantId: tenant._id,
        locationId: { $in: locations.map(({ _id }) => _id) },
        staffId: { $in: [...eligibleStaffIds] },
      })
      .lean()
      .exec();
    const base = {
      name: access.account?.businessName ?? tenant.name,
      slug: access.account?.slug ?? tenant.slug,
      locations: locations.map(locationView),
      businessHours: businessHoursView(
        schedules.filter(
          ({ staffId, locationId }) =>
            staffLocations.get(staffId) === locationId,
        ),
      ),
    };
    if (!access.profile) return base;
    return {
      ...base,
      ...accountProfileView(access.profile),
      bookingEnabled: access.bookingEnabled,
    };
  }

  async locations(tenantId: string): Promise<{ items: LocationView[] }> {
    const locations = await this.database.models.location
      .find({ tenantId })
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
    return { items: locations.map(locationView) };
  }

  async location(tenantId: string, locationId: string): Promise<LocationView> {
    const location = await this.database.models.location
      .findOne({ _id: locationId, tenantId })
      .lean()
      .exec();
    if (!location) {
      throw this.notFound('LOCATION_NOT_FOUND', 'Location not found');
    }
    return locationView(location);
  }

  async updateLocation(
    tenantId: string,
    locationId: string,
    name: string,
  ): Promise<LocationView> {
    const location = await this.database.models.location
      .findOneAndUpdate(
        { _id: locationId, tenantId },
        { $set: { name: name.trim() } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!location) {
      throw this.notFound('LOCATION_NOT_FOUND', 'Location not found');
    }
    return locationView(location);
  }

  private notFound(reasonCode: string, message: string): AppException {
    return new AppException(404, reasonCode, message);
  }
}

function locationView(location: LocationEntity): LocationView {
  return {
    id: location._id,
    name: location.name,
    timezone: location.timezone,
    publicBookingEnabled: location.publicBookingEnabled,
  };
}

function businessHoursView(
  schedules: ScheduleEntity[],
): PublicLocationBusinessHours[] {
  const groups = new Map<
    string,
    {
      locationId: string;
      dayOfWeek: number;
      intervals: Map<string, BusinessHoursInterval>;
    }
  >();

  for (const schedule of schedules) {
    const groupKey = `${schedule.locationId}:${schedule.dayOfWeek}`;
    const group = groups.get(groupKey) ?? {
      locationId: schedule.locationId,
      dayOfWeek: schedule.dayOfWeek,
      intervals: new Map<string, BusinessHoursInterval>(),
    };
    group.intervals.set(`${schedule.startsAt}:${schedule.endsAt}`, {
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt,
    });
    groups.set(groupKey, group);
  }

  return [...groups.values()]
    .map(({ locationId, dayOfWeek, intervals }) => ({
      locationId,
      dayOfWeek,
      intervals: [...intervals.values()].sort(
        (left, right) =>
          left.startsAt.localeCompare(right.startsAt) ||
          left.endsAt.localeCompare(right.endsAt),
      ),
    }))
    .sort(
      (left, right) =>
        left.locationId.localeCompare(right.locationId) ||
        left.dayOfWeek - right.dayOfWeek,
    );
}
