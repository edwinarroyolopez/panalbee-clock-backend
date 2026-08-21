import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { InternalAuthContext } from '../auth/auth.types';
import { hashPassword } from '../auth/password';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { INDEX_NAMES, isNamedDuplicateKey } from '../database/models';
import { CreateAccountDto } from './accounts.dto';

const RESERVED_SLUGS = new Set([
  'api',
  'login',
  'admin',
  'backoffice',
  'design-system',
  '_next',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
]);

@Injectable()
export class AccountProvisioningService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async provision(
    dto: CreateAccountDto,
    actor: InternalAuthContext,
    requestId: string,
  ): Promise<string> {
    if (actor.internalRole !== 'PLATFORM_ADMIN') {
      throw new AppException(403, 'INSUFFICIENT_ROLE', 'Access is denied');
    }
    if (RESERVED_SLUGS.has(dto.slug)) {
      throw new AppException(
        400,
        'ACCOUNT_SLUG_RESERVED',
        'Account slug is reserved',
      );
    }

    const ids = {
      account: randomUUID(),
      tenant: randomUUID(),
      location: randomUUID(),
      owner: randomUUID(),
      membership: randomUUID(),
      profile: randomUUID(),
    };
    const passwordHash = await hashPassword(dto.ownerPassword);
    const tenantStatus = dto.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';

    try {
      await this.database.withTransaction(async (session) => {
        await this.database.models.account.create(
          [
            {
              _id: ids.account,
              businessName: dto.businessName,
              slug: dto.slug,
              status: dto.status,
              ownerUserId: ids.owner,
              tenantId: ids.tenant,
              phone: dto.ownerPhone,
              ...(dto.planCode ? { planCode: dto.planCode } : {}),
              publicBookingEnabled: dto.publicBookingEnabled,
            },
          ],
          { session },
        );
        await this.database.models.tenant.create(
          [
            {
              _id: ids.tenant,
              name: dto.businessName,
              slug: dto.slug,
              status: tenantStatus,
            },
          ],
          { session },
        );
        await this.database.models.location.create(
          [
            {
              _id: ids.location,
              tenantId: ids.tenant,
              name: dto.locationName,
              timezone: dto.timezone,
              publicBookingEnabled: dto.publicBookingEnabled,
            },
          ],
          { session },
        );
        await this.database.models.user.create(
          [
            {
              _id: ids.owner,
              email: dto.ownerEmail,
              phone: dto.ownerPhone,
              displayName: `${dto.businessName} Owner`,
              passwordHash,
              actorType: 'TENANT',
              status: 'ACTIVE',
            },
          ],
          { session },
        );
        await this.database.models.tenantMembership.create(
          [
            {
              _id: ids.membership,
              tenantId: ids.tenant,
              userId: ids.owner,
              role: 'OWNER',
            },
          ],
          { session },
        );
        await this.database.models.accountPublicProfile.create(
          [
            {
              _id: ids.profile,
              accountId: ids.account,
              headline: dto.businessName,
              description: '',
              theme: 'default',
              contactInfo: { phone: dto.ownerPhone },
              bookingEnabled: dto.publicBookingEnabled,
            },
          ],
          { session },
        );
        await this.audit.record(
          {
            tenantId: ids.tenant,
            actorUserId: actor.userId,
            actorType: 'INTERNAL_USER',
            action: 'ACCOUNT_CREATED',
            entityType: 'account',
            entityId: ids.account,
            requestId,
            metadata: {
              initialStatus: dto.status,
              tenantId: ids.tenant,
              locationId: ids.location,
              ownerUserId: ids.owner,
            },
          },
          session,
        );
      });
      return ids.account;
    } catch (error) {
      throw mapProvisioningConflict(error);
    }
  }
}

function mapProvisioningConflict(error: unknown): unknown {
  if (
    isNamedDuplicateKey(error, INDEX_NAMES.accountSlug) ||
    isNamedDuplicateKey(error, INDEX_NAMES.tenantSlug)
  ) {
    return new AppException(
      409,
      'ACCOUNT_SLUG_CONFLICT',
      'An account already uses this slug',
    );
  }
  if (isNamedDuplicateKey(error, INDEX_NAMES.userEmail)) {
    return new AppException(
      409,
      'OWNER_EMAIL_CONFLICT',
      'Owner email is already registered',
    );
  }
  if (isNamedDuplicateKey(error, INDEX_NAMES.userPhone)) {
    return new AppException(
      409,
      'OWNER_PHONE_CONFLICT',
      'Owner phone is already registered',
    );
  }
  if (isNamedDuplicateKey(error, INDEX_NAMES.accountTenant)) {
    return new AppException(
      409,
      'ACCOUNT_TENANT_CONFLICT',
      'Tenant is already linked to an account',
    );
  }
  return error;
}
