import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { LocationEntity } from '../database/models';

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

export interface PublicTenantContext {
  name: string;
  slug: string;
  locations: LocationView[];
}

@Injectable()
export class TenantsService {
  constructor(private readonly database: DatabaseService) {}

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
    const tenant = await this.database.models.tenant
      .findOne({ slug, status: 'ACTIVE' })
      .lean()
      .exec();
    if (!tenant) throw this.notFound('TENANT_NOT_FOUND', 'Tenant not found');
    const locations = await this.database.models.location
      .find({ tenantId: tenant._id, publicBookingEnabled: true })
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
    return {
      name: tenant.name,
      slug: tenant.slug,
      locations: locations.map(locationView),
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
