import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  ServiceEntity,
  StaffEntity,
  StaffServiceEntity,
} from '../database/models';
import {
  AddStaffServiceDto,
  CreateStaffDto,
  StaffListQueryDto,
} from './staff.dto';

export interface StaffServiceView {
  serviceId: string;
  serviceName: string;
  durationOverrideMinutes: number | null;
}

export interface StaffView {
  id: string;
  locationId: string;
  displayName: string;
  active: boolean;
  services: StaffServiceView[];
}

@Injectable()
export class StaffService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    tenantId: string,
    query: StaffListQueryDto,
  ): Promise<{ items: StaffView[] }> {
    let eligibleIds: string[] | undefined;
    if (query.serviceId) {
      eligibleIds = await this.database.models.staffService.distinct(
        'staffId',
        { tenantId, serviceId: query.serviceId },
      );
    }
    const staff = await this.database.models.staff
      .find({
        tenantId,
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(eligibleIds ? { _id: { $in: eligibleIds } } : {}),
      })
      .sort({ displayName: 1, _id: 1 })
      .lean()
      .exec();
    const relations = await this.database.models.staffService
      .find({ tenantId, staffId: { $in: staff.map(({ _id }) => _id) } })
      .lean()
      .exec();
    const serviceIds = [
      ...new Set(relations.map(({ serviceId }) => serviceId)),
    ];
    const services = await this.database.models.service
      .find({ tenantId, _id: { $in: serviceIds } })
      .lean()
      .exec();
    return { items: staff.map((item) => staffView(item, relations, services)) };
  }

  async create(tenantId: string, dto: CreateStaffDto): Promise<StaffView> {
    const location = await this.database.models.location
      .exists({ _id: dto.locationId, tenantId })
      .exec();
    if (!location) {
      throw new AppException(404, 'LOCATION_NOT_FOUND', 'Location not found');
    }
    const staff = await this.database.models.staff.create({
      tenantId,
      locationId: dto.locationId,
      displayName: dto.displayName.trim(),
      active: dto.active ?? true,
    });
    return staffView(staff.toObject(), [], []);
  }

  async addService(
    tenantId: string,
    staffId: string,
    dto: AddStaffServiceDto,
  ): Promise<StaffServiceView> {
    const [staff, service] = await Promise.all([
      this.database.models.staff.exists({ _id: staffId, tenantId }).exec(),
      this.database.models.service
        .findOne({ _id: dto.serviceId, tenantId })
        .lean()
        .exec(),
    ]);
    if (!staff || !service) {
      throw new AppException(
        404,
        'STAFF_OR_SERVICE_NOT_FOUND',
        'Staff member or service not found',
      );
    }
    const relation = await this.database.models.staffService
      .findOneAndUpdate(
        { tenantId, staffId, serviceId: dto.serviceId },
        {
          $set: {
            durationOverrideMinutes: dto.durationOverrideMinutes ?? null,
          },
          $setOnInsert: { tenantId, staffId, serviceId: dto.serviceId },
        },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    return staffServiceView(relation, service);
  }
}

function staffView(
  staff: StaffEntity,
  relations: StaffServiceEntity[],
  services: ServiceEntity[],
): StaffView {
  const serviceById = new Map(
    services.map((service) => [service._id, service]),
  );
  const assigned = relations
    .filter(({ staffId }) => staffId === staff._id)
    .flatMap((relation) => {
      const service = serviceById.get(relation.serviceId);
      return service ? [staffServiceView(relation, service)] : [];
    })
    .sort(
      (left, right) =>
        left.serviceName.localeCompare(right.serviceName) ||
        left.serviceId.localeCompare(right.serviceId),
    );
  return {
    id: staff._id,
    locationId: staff.locationId,
    displayName: staff.displayName,
    active: staff.active,
    services: assigned,
  };
}

function staffServiceView(
  relation: StaffServiceEntity,
  service: ServiceEntity,
): StaffServiceView {
  return {
    serviceId: service._id,
    serviceName: service.name,
    durationOverrideMinutes: relation.durationOverrideMinutes ?? null,
  };
}
