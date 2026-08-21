import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { TenantOperationAuthContext } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { AccountEntity, AccountPublicProfileEntity } from '../database/models';
import { UpdatePublicProfileDto } from './accounts.dto';
import {
  TenantAccountView,
  accountListItemView,
  accountProfileView,
} from './account.views';

@Injectable()
export class AccountProfileService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async get(
    slug: string,
    actor: TenantOperationAuthContext,
  ): Promise<TenantAccountView> {
    const account = await this.loadAccount(slug, actor);
    const profile = await this.database.models.accountPublicProfile
      .findOne({ accountId: account._id })
      .lean()
      .exec();
    if (!profile) throw accountNotFound();
    return tenantAccountView(account, profile);
  }

  async update(
    slug: string,
    dto: UpdatePublicProfileDto,
    actor: TenantOperationAuthContext,
    requestId: string,
  ): Promise<TenantAccountView> {
    await this.database.withTransaction(async (session) => {
      const account = await this.loadAccount(slug, actor, session);
      const profile = await this.database.models.accountPublicProfile
        .findOne({ accountId: account._id })
        .session(session)
        .lean()
        .exec();
      if (!profile) throw accountNotFound();

      const { updates, changedFields } = profileUpdates(profile, dto);
      if (Object.keys(updates).length > 0) {
        await this.database.models.accountPublicProfile.updateOne(
          { _id: profile._id, accountId: account._id },
          { $set: updates },
          { runValidators: true, session },
        );
      }
      if (changedFields.length === 0) return;

      await this.audit.record(
        {
          tenantId: account.tenantId,
          actorUserId: actor.userId,
          actorType:
            actor.actorType === 'DELEGATED' ? 'INTERNAL_USER' : 'TENANT_USER',
          action: 'PUBLIC_PROFILE_UPDATED',
          entityType: 'account',
          entityId: account._id,
          requestId,
          metadata: {
            changedFields: changedFields.sort(),
          },
        },
        session,
      );
    });
    return this.get(slug, actor);
  }

  private async loadAccount(
    slug: string,
    actor: TenantOperationAuthContext,
    session?: ClientSession,
  ): Promise<AccountEntity> {
    if (slug !== actor.tenant.slug) throw accountNotFound();
    const account = await this.database.models.account
      .findOne({ slug, tenantId: actor.tenant.id })
      .session(session ?? null)
      .lean()
      .exec();
    if (!account) throw accountNotFound();
    return account;
  }
}

function profileUpdates(
  profile: AccountPublicProfileEntity,
  dto: UpdatePublicProfileDto,
): { updates: Record<string, unknown>; changedFields: string[] } {
  const updates: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const field of [
    'headline',
    'description',
    'logo',
    'coverImage',
    'theme',
    'bookingEnabled',
  ] as const) {
    const value = dto[field];
    if (value !== undefined && value !== (profile[field] ?? null)) {
      updates[field] = value;
      changedFields.push(field);
    }
  }
  if (dto.contactInfo) {
    const next = { ...profile.contactInfo, ...dto.contactInfo };
    if (JSON.stringify(next) !== JSON.stringify(profile.contactInfo)) {
      updates.contactInfo = next;
      changedFields.push('contactInfo');
    }
  }
  return { updates, changedFields };
}

function tenantAccountView(
  account: AccountEntity,
  profile: AccountPublicProfileEntity,
): TenantAccountView {
  return {
    ...accountListItemView(account),
    publicProfile: accountProfileView(profile),
  };
}

function accountNotFound(): AppException {
  return new AppException(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
}
