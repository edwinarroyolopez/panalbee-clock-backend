import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  INDEX_NAMES,
  isNamedDuplicateKey,
  ServiceEntity,
} from '../database/models';
import { CreateServiceDto } from './service.dto';

export interface ServiceView {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  active: boolean;
}

@Injectable()
export class CatalogService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string): Promise<{ items: ServiceView[] }> {
    const services = await this.database.models.service
      .find({ tenantId })
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
    return { items: services.map(serviceView) };
  }

  async listPublic(tenantSlug: string): Promise<{ items: ServiceView[] }> {
    const tenant = await this.database.models.tenant
      .findOne({ slug: tenantSlug, status: 'ACTIVE' })
      .lean()
      .exec();
    if (!tenant) {
      throw new AppException(404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }
    const services = await this.database.models.service
      .find({ tenantId: tenant._id, active: true })
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
    return { items: services.map(serviceView) };
  }

  async create(tenantId: string, dto: CreateServiceDto): Promise<ServiceView> {
    try {
      const service = await this.database.models.service.create({
        tenantId,
        name: dto.name.trim(),
        ...(dto.description?.trim()
          ? { description: dto.description.trim() }
          : {}),
        durationMinutes: dto.durationMinutes,
        priceMinor: dto.priceMinor ?? 0,
        currency: dto.currency ?? 'COP',
        active: dto.active ?? true,
      });
      return serviceView(service.toObject());
    } catch (error) {
      if (isNamedDuplicateKey(error, INDEX_NAMES.serviceName)) {
        throw new AppException(
          409,
          'SERVICE_NAME_CONFLICT',
          'A service already uses this name',
        );
      }
      throw error;
    }
  }
}

function serviceView(service: ServiceEntity): ServiceView {
  return {
    id: service._id,
    name: service.name,
    description: service.description ?? null,
    durationMinutes: service.durationMinutes,
    priceMinor: service.priceMinor,
    currency: service.currency,
    active: service.active,
  };
}
