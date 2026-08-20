import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { InternalAuthContext } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { AuditEventEntity, TenantEntity } from '../database/models';
import { TenantStatus } from './backoffice.dto';

export interface BackofficeTenantView {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: Date;
}

export interface BackofficeAuditView {
  id: string;
  tenantId: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  createdAt: Date;
}

@Injectable()
export class BackofficeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  async tenants(): Promise<{ items: BackofficeTenantView[] }> {
    const tenants = await this.database.models.tenant
      .find({})
      .sort({ createdAt: -1, _id: 1 })
      .lean()
      .exec();
    return { items: tenants.map(tenantView) };
  }

  async listAudit(): Promise<{ items: BackofficeAuditView[] }> {
    const events = await this.database.models.auditEvent
      .find({})
      .select({
        tenantId: 1,
        actorType: 1,
        action: 1,
        entityType: 1,
        entityId: 1,
        reason: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean()
      .exec();
    return { items: events.map(auditView) };
  }

  async updateTenantStatus(
    tenantId: string,
    status: TenantStatus,
    reason: string,
    actor: InternalAuthContext,
    requestId: string,
  ): Promise<BackofficeTenantView> {
    if (actor.internalRole !== 'PLATFORM_ADMIN') {
      throw new AppException(403, 'INSUFFICIENT_ROLE', 'Access is denied');
    }
    return this.database.withTransaction(async (session) => {
      const existing = await this.database.models.tenant
        .findOne({ _id: tenantId })
        .session(session)
        .lean()
        .exec();
      if (!existing) {
        throw new AppException(404, 'TENANT_NOT_FOUND', 'Tenant not found');
      }
      const updated = await this.database.models.tenant
        .findOneAndUpdate(
          { _id: tenantId },
          { $set: { status } },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean()
        .exec();
      if (!updated) {
        throw new AppException(404, 'TENANT_NOT_FOUND', 'Tenant not found');
      }
      await this.auditService.recordSensitive(
        {
          tenantId,
          actorUserId: actor.userId,
          action: 'TENANT_STATUS_CHANGED',
          entityType: 'tenant',
          entityId: tenantId,
          reason,
          requestId,
          metadata: { previousStatus: existing.status, newStatus: status },
        },
        session,
      );
      return tenantView(updated);
    });
  }
}

function tenantView(tenant: TenantEntity): BackofficeTenantView {
  return {
    id: tenant._id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    createdAt: tenant.createdAt,
  };
}

function auditView(event: AuditEventEntity): BackofficeAuditView {
  return {
    id: event._id,
    tenantId: event.tenantId ?? null,
    actorType: event.actorType,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    reason: event.reason ?? null,
    createdAt: event.createdAt,
  };
}
