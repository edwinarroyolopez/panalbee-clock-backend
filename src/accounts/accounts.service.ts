import { Injectable } from '@nestjs/common';
import { AuditService, validateAuditReason } from '../audit/audit.service';
import { InternalAuthContext } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { AccountEntity, AuditEventEntity } from '../database/models';
import { UpdateAccountStatusDto } from './accounts.dto';
import {
  AccountAuditView,
  AccountDetailView,
  AccountListItemView,
  accountListItemView,
  accountProfileView,
} from './account.views';

@Injectable()
export class AccountsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<{ items: AccountListItemView[] }> {
    const accounts = await this.database.models.account
      .find({})
      .sort({ createdAt: -1, _id: 1 })
      .lean()
      .exec();
    return { items: accounts.map(accountListItemView) };
  }

  async detail(accountId: string): Promise<AccountDetailView> {
    const account = await this.database.models.account
      .findById(accountId)
      .lean()
      .exec();
    if (!account) throw accountNotFound();
    const [owner, profile] = await Promise.all([
      this.database.models.user.findById(account.ownerUserId).lean().exec(),
      this.database.models.accountPublicProfile
        .findOne({ accountId: account._id })
        .lean()
        .exec(),
    ]);
    if (!owner || !profile) {
      throw new AppException(
        409,
        'ACCOUNT_INCOMPLETE',
        'Account provisioning is incomplete',
      );
    }
    return {
      ...accountListItemView(account),
      tenantId: account.tenantId,
      owner: {
        id: owner._id,
        displayName: owner.displayName,
        email: owner.email ?? null,
        phone: owner.phone ?? null,
        status: owner.status,
      },
      publicProfile: accountProfileView(profile),
    };
  }

  async updateStatus(
    accountId: string,
    dto: UpdateAccountStatusDto,
    actor: InternalAuthContext,
    requestId: string,
  ): Promise<AccountDetailView> {
    if (actor.internalRole !== 'PLATFORM_ADMIN') {
      throw new AppException(403, 'INSUFFICIENT_ROLE', 'Access is denied');
    }
    const reason = validateAuditReason(dto.reason);
    await this.database.withTransaction(async (session) => {
      const account = await this.database.models.account
        .findById(accountId)
        .session(session)
        .lean()
        .exec();
      if (!account) throw accountNotFound();
      if (account.status === dto.status) return;
      assertTransition(account, dto.status);

      const tenantStatus = dto.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED';
      const tenant = await this.database.models.tenant
        .findOneAndUpdate(
          { _id: account.tenantId },
          { $set: { status: tenantStatus } },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean()
        .exec();
      if (!tenant) {
        throw new AppException(
          409,
          'ACCOUNT_TENANT_LINK_INVALID',
          'Linked tenant was not found',
        );
      }
      await this.database.models.account.updateOne(
        { _id: account._id },
        { $set: { status: dto.status } },
        { runValidators: true, session },
      );
      await this.audit.record(
        {
          tenantId: account.tenantId,
          actorUserId: actor.userId,
          actorType: 'INTERNAL_USER',
          action:
            dto.status === 'ACTIVE' ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_SUSPENDED',
          entityType: 'account',
          entityId: account._id,
          reason,
          requestId,
          metadata: {
            previousStatus: account.status,
            newStatus: dto.status,
            tenantStatus,
          },
        },
        session,
      );
    });
    return this.detail(accountId);
  }

  async auditTrail(accountId: string): Promise<{ items: AccountAuditView[] }> {
    const account = await this.database.models.account
      .findById(accountId)
      .select({ tenantId: 1 })
      .lean()
      .exec();
    if (!account) throw accountNotFound();
    const events = await this.database.models.auditEvent
      .find({ tenantId: account.tenantId })
      .select({
        actorUserId: 1,
        actorType: 1,
        action: 1,
        entityType: 1,
        entityId: 1,
        reason: 1,
        requestId: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1, _id: -1 })
      .lean()
      .exec();
    return { items: events.map(accountAuditView) };
  }
}

function assertTransition(
  account: AccountEntity,
  next: 'ACTIVE' | 'SUSPENDED',
): void {
  const allowed =
    (account.status === 'TRIAL' && ['ACTIVE', 'SUSPENDED'].includes(next)) ||
    (account.status === 'ACTIVE' && next === 'SUSPENDED') ||
    (account.status === 'SUSPENDED' && next === 'ACTIVE');
  if (!allowed) {
    throw new AppException(
      409,
      'ACCOUNT_STATUS_TRANSITION_INVALID',
      'Account status transition is not allowed',
    );
  }
}

function accountAuditView(event: AuditEventEntity): AccountAuditView {
  return {
    id: event._id,
    actorType: event.actorType,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    reason: event.reason ?? null,
    requestId: event.requestId ?? null,
    createdAt: event.createdAt,
  };
}

function accountNotFound(): AppException {
  return new AppException(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
}
