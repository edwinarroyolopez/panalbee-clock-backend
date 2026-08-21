import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AccountPublicAccessService } from './account-public-access.service';

export interface PublicAccountStaffView {
  id: string;
  locationId: string;
  displayName: string;
  serviceIds: string[];
}

@Injectable()
export class PublicAccountStaffService {
  constructor(
    private readonly database: DatabaseService,
    private readonly publicAccess: AccountPublicAccessService,
  ) {}

  async list(
    accountSlug: string,
  ): Promise<{ items: PublicAccountStaffView[] }> {
    const { tenant } = await this.publicAccess.resolve(accountSlug);
    const publicLocationIds = await this.database.models.location.distinct(
      '_id',
      { tenantId: tenant._id, publicBookingEnabled: true },
    );
    const staff = await this.database.models.staff
      .find({
        tenantId: tenant._id,
        locationId: { $in: publicLocationIds },
        active: true,
      })
      .sort({ displayName: 1, _id: 1 })
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
    const serviceIdsByStaff = new Map<string, string[]>();
    for (const relation of relations) {
      if (!activeServiceIds.has(relation.serviceId)) continue;
      const serviceIds = serviceIdsByStaff.get(relation.staffId) ?? [];
      serviceIds.push(relation.serviceId);
      serviceIdsByStaff.set(relation.staffId, serviceIds);
    }

    return {
      items: staff.flatMap((member) => {
        const serviceIds = serviceIdsByStaff.get(member._id);
        return serviceIds?.length
          ? [
              {
                id: member._id,
                locationId: member.locationId,
                displayName: member.displayName,
                serviceIds: [...new Set(serviceIds)].sort(),
              },
            ]
          : [];
      }),
    };
  }
}
