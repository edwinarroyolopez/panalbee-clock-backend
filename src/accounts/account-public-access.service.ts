import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  AccountEntity,
  AccountPublicProfileEntity,
  TenantEntity,
} from '../database/models';

export interface PublicAccountAccess {
  tenant: TenantEntity;
  account?: AccountEntity;
  profile?: AccountPublicProfileEntity;
  bookingEnabled: boolean;
}

interface ResolveOptions {
  requireAccount?: boolean;
  requireBooking?: boolean;
  session?: ClientSession;
}

@Injectable()
export class AccountPublicAccessService {
  constructor(private readonly database: DatabaseService) {}

  async resolve(
    slugInput: string,
    options: ResolveOptions = {},
  ): Promise<PublicAccountAccess> {
    const slug = slugInput.trim().toLowerCase();
    const session = options.session ?? null;
    const account = await this.database.models.account
      .findOne({ slug })
      .session(session)
      .lean()
      .exec();

    if (!account) {
      if (options.requireAccount) throw publicAccountUnavailable();
      const tenant = await this.database.models.tenant
        .findOne({ slug, status: 'ACTIVE' })
        .session(session)
        .lean()
        .exec();
      if (!tenant) {
        throw new AppException(404, 'TENANT_NOT_FOUND', 'Tenant not found');
      }
      return { tenant, bookingEnabled: true };
    }

    const tenant = await this.database.models.tenant
      .findOne({
        _id: account.tenantId,
        slug: account.slug,
        status: 'ACTIVE',
      })
      .session(session)
      .lean()
      .exec();
    const profile = await this.database.models.accountPublicProfile
      .findOne({ accountId: account._id })
      .session(session)
      .lean()
      .exec();
    const active = account.status === 'TRIAL' || account.status === 'ACTIVE';
    if (!active || !tenant || !profile) throw publicAccountUnavailable();

    const bookingEnabled =
      account.publicBookingEnabled && profile.bookingEnabled;
    if (options.requireBooking && !bookingEnabled) {
      throw publicAccountUnavailable();
    }
    return { tenant, account, profile, bookingEnabled };
  }

  async assertTenantBookingEnabled(
    tenantId: string,
    session?: ClientSession,
  ): Promise<void> {
    const account = await this.database.models.account
      .findOne({ tenantId })
      .session(session ?? null)
      .lean()
      .exec();
    if (!account) return;

    const profile = await this.database.models.accountPublicProfile
      .findOne({ accountId: account._id, bookingEnabled: true })
      .session(session ?? null)
      .lean()
      .exec();
    if (
      !profile ||
      !account.publicBookingEnabled ||
      (account.status !== 'TRIAL' && account.status !== 'ACTIVE')
    ) {
      throw publicAccountUnavailable();
    }
  }
}

export function publicAccountUnavailable(): AppException {
  return new AppException(
    404,
    'PUBLIC_ACCOUNT_UNAVAILABLE',
    'Public account is unavailable',
  );
}
